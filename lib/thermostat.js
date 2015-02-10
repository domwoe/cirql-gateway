/*jslint node: true */
'use strict';

var fhem = require('./fhem');
var os = require('os');

var Firebase = require('firebase');

var config = require('../config');

var bunyan = require('bunyan');
var bunyanLogentries = require('bunyan-logentries');

var hostname = os.hostname();

// create the logger
var log = bunyan.createLogger({
    name: "gateway",
    streams: [{
        stream: process.stdout,
        level: "info"
    }, {
        level: 'info',
        stream: bunyanLogentries.createStream({
            token: '2f63e221-e11a-44e3-b5f3-3bd09a39bdc2'
        }),
        type: 'raw'
    }]
});

function Thermostat(homeId, id) {
    this.homeId = homeId;
    this.id = id;
    this.intervals = {};
    this.target = null;
    this.waitForThermostat = false;
    this.retries = 1;
    this.extTempTimer = null;
    this.firstAction = true;
    this.status = null;
    this.trvTemp = null;
    this.extTemp = null;
    this.isPeered = null;
    this.peeredSensor = null;
    this.extTempHasChanged = null;
    this.virtualTempInterval = null;

    this.fbRef = new Firebase(config.firebase + '/homes/' + this.homeId + '/thermostats/' + this.id);

    this.fbRef.child('waitForThermostat').set(false);
    this.fbRef.child('hasExternalTempSensor').set(false);
    this.fbRef.child('externalTempSensorIsPeered').set(false);
    this.fbRef.child('usesExternalTemp').set(false);

    // Save serial number in firebase if there isn't
    // a serial number already
    this.fbRef.once('value', function(thermostatSnap) {
        if (!thermostatSnap.hasChild('serialNo')) {
            var self = this;
            fhem.getSerialNo(id, function(err, value) {
                if (err) {
                    log.warn(err);
                } else {
                    self.fbRef.child('serialNo').set(value);
                }
            });
        }
    }, this);

    this.fbRef.child('room').on('value', function(fbRoom) {

        if (fbRoom.val()) {

            log.info({
                host: hostname,
                thermostat: this.id
            }, 'Thermostat now belongs to room: '+fbRoom.val());
        }

    }, this);

    this.fbRef.child('state').on('value', function(fbState) {
        var state = fbState.val();

        if (typeof(state) === 'string' && state.toUpperCase().trim() === 'NACK') {
            log.info({
                host: hostname,
                thermostat: this.id
            }, 'Got NACK from thermostat');
            fhem.write('set ' + this.id + '_Weather getConfig\n');
            if (this.isPeered) {
                if (Math.abs(parseFloat(this.trvTemp) - parseFloat(this.extTemp)) > 1) {
                    log.info({
                        host: hostname,
                        thermostat: this.id
                    }, 'TRV temperature deviates significantly from Netatmo temperature');
                    this.fbRef.child('usesExternalTemp').set(false);
                }
            }
            // this.fbRef.child('status').on('value', function(fbStatus) {
            //     var status = fbStatus.val();
            //     if (status === 'max retries') {
            //         log.info({
            //             host: hostname,
            //             thermostat: this.id
            //         }, 'Thermostat probably needs new pairing');
            //         this.fbRef.child('status').set('PROBABLY NEEDS NEW PAIRING');
            //     }
            // }, this);

        }

    }, this);


    // Listen to target changes on Firebase
    this.fbRef.child('target').on('value', function(target) {

        var target = parseFloat(target.val());

        // Get current target temperature of thermostat
        this.fbRef.child('fhem_desired-temp').once('value', function(fhemTarget) {
            log.info({
                    host: hostname,
                    thermostat: this.id
                },
                "New target coming from backend: " + target +
                " Old target (this.target): " + this.target +
                " Target at thermostat (fhem_desired-temp): " + fhemTarget.val() +
                " waitForThermostat: " + this.waitForThermostat
            );

            fhemTarget = parseFloat(fhemTarget.val());


            // Is new target defined and different from the current one?
            if (target !== this.target && target !== fhemTarget && typeof target != 'undefined' && !isNaN(target)) {

                this.target = target;

                log.info({
                        host: hostname,
                        thermostat: this.id
                    },
                    "Set new target at thermostat: " + target
                );


                // Set target temperature at thermostat
                var setTarget;
                if (this.setTargetInterval) {
                    clearTimeout(this.setTargetInterval);
                }
                (setTarget = function() {
                    fhem.setTarget(id, target);
                })();

                // Target change came from backend not from local user
                this.fbRef.child('manualChange').set(false);
                log.info({
                        host: hostname,
                        thermostat: this.id
                    },
                    "Set manualChange to false"
                );

                // This will be set to false as soon as the thermostat
                // has acknowledged the new target temperature
                this.waitForThermostat = true;
                this.fbRef.child('waitForThermostat').set(true);

                this.status = 'wait';
                this.fbRef.child('status').set('wait');
                log.info({
                        host: hostname,
                        thermostat: this.id
                    },
                    "Set waitForThermostat to true"
                );

                var self = this;

                // Up to 10 Retries if thermostat doen't acknoweledge 
                (function retry() {
                    self.setTargetInterval = setTimeout(
                        function() {
                            if (self.retries <= 10) {
                                log.info({
                                    host: hostname,
                                    thermostat: self.id
                                }, 'Retry ' + self.retries + ' to set target of ' + id);
                                self.status = 'retry ' + self.retries;
                                self.fbRef.child('status').set('retry ' + self.retries);
                                setTarget();
                                self.retries++;
                                retry();
                            } else {
                                log.warn({
                                    host: hostname,
                                    thermostat: self.id
                                }, 'Target of ' + id + ' could not be set. Stop retrying.');
                                clearTimeout(self.setTargetInterval);
                                self.retries = 1;
                                self.status = 'max retries';
                                self.fbRef.child('status').set('max retries');
                                self.waitForThermostat = false;
                                self.fbRef.child('waitForThermostat').set(false);
                            }
                        }, 30 * 1000 * self.retries);
                })();
            } else if (target === fhemTarget) {
                this.status = 'success';
                this.fbRef.child('status').set('success');
                log.info({
                        host: hostname,
                        thermostat: this.id
                    },
                    'Thermostat already set to ' + target
                );

            } else {

                this.target = target;

                log.info({
                        host: hostname,
                        thermostat: this.id
                    },
                    "Haven't set target of thermostat because " +
                    target + " !== " + this.target + " && " + target + " !== " +
                    fhemTarget + " && " + typeof target + " != 'undefined' && " + !isNaN(target)
                );
            }
        }, this);
    }, this);

    // Listen for changes of target at thermostat
    this.fbRef.child('fhem_desired-temp').on('value', function(fhemTarget) {
        log.info({
                host: hostname,
                thermostat: this.id
            },
            "New fhem_desired-temp: " + fhemTarget.val() +
            " waitForThermostat: " + this.waitForThermostat +
            " Current target (this.target): " + this.target
        );
        if (this.firstAction) {
            this.firstAction = false;
            return;
        }
        var fhemTarget = parseFloat(fhemTarget.val());
        log.info({
            host: hostname,
            thermostat: this.id
        }, 'New target has arrived at thermostat. Set waitForThermostat to false');
        // Target writing was successful
        if (this.waitForThermostat === true && fhemTarget === this.target) {
            this.status = 'success';
            this.fbRef.child('status').set('success');
            this.waitForThermostat = false;
            this.fbRef.child('waitForThermostat').set(false);
            clearTimeout(this.setTargetInterval);
            this.retries = 1;
        }
        // Manual change at Thermostat
        else if (this.waitForThermostat === false && fhemTarget !== this.target && typeof fhemTarget != 'undefined' && !isNaN(fhemTarget)) {
            log.info({
                host: hostname,
                thermostat: this.id
            }, 'Manual change to ' + fhemTarget);
            this.target = fhemTarget;
            var self = this;
            this.fbRef.child('target').set(fhemTarget, function(error) {
                if (error) {
                    log.warn({
                        host: hostname,
                        thermostat: this.id
                    }, 'Thermostat.js: ' + error);
                } else {
                    self.fbRef.child('manualChange').set(true);
                    self.status = 'manual change';
                    self.fbRef.child('status').set('manual change');
                }
            });
        } else {
            log.warn({
                host: hostname,
                thermostat: this.id
            }, 'Change in fhem_desired-temp but was not waiting for a new target and do not expect manualChange');
        }
    }, this);

    this.fbRef.child('fhem_measured-temp').on('value', function(trvTemp) {
        this.trvTemp = trvTemp;
    }, this);

    this.fbRef.child('externalTemperature').on('value', function(extTempObj) {


        if (extTempObj.hasChild('timestamp') && extTempObj.hasChild('value')) {

            var timestamp = extTempObj.child('timestamp').val();
            this.extTempHasChanged = (this.extTemp !== extTempObj.child('value').val());
        
            this.extTemp = extTempObj.child('value').val();

            var upToDate = ((Date.now() - timestamp) < 30 * 60 * 1000) ? true : false;

            // log.info({
            //     host: hostname
            // }, 'Update from external temperature sensor for thermostat ' + id + ' Up to date: ' + upToDate);

            var self = this;

            self.hasExternalTempSensor(function(error, hasSensor) {
                if (!error) {
                    // console.log('---------------------');
                    // console.log('THERMOSTAT: '+ self.id);
                    // console.log('VIRTUALSENOR: '+hasSensor);
                    // console.log('---------------------');
                    self.virtualSensor = hasSensor;
                    self.fbRef.child('hasExternalTempSensor').set(true);
                    if (!hasSensor) {

                        self.fbRef.child('hasExternalTempSensor').set(false);

                        log.info({
                            host: hostname
                        }, 'Defining virtual temperature sensor for ' + self.id);

                        self.defineVirtualSensor();

                    }

                    var that = self;

                    that.getPeeredSensor(function(error, sensorId) {
                        // console.log('---------------------');
                        // console.log('SENSORID: '+sensorId);
                        // console.log('VIRTUALSENOR: '+that.virtualSensor);
                        // console.log('---------------------');
                        that.peeredSensor = sensorId;
                        if (sensorId + '' === that.virtualSensor + '' || sensorId + '' === 'extTemp_' + that.id + '_Btn1') {
                            that.isPeered = true;
                        } else if (sensorId && that.virtualSensor) {
                            // wrong peer
                            that.unpeerVirtualSensor();
                        } else {
                            that.isPeered = false;
                        }

                        // log.info({
                        //     host: hostname
                        // }, 'virtual sensor for ' + that.id + ' peered ? ' + isPeered);

                        if (!error) {
                            if (!that.isPeered) {
                                that.fbRef.child('externalTempSensorIsPeered').set(false);
                                that.fbRef.child('usesExternalTemp').set(false);

                                if (upToDate) {

                                    that.peerVirtualSensor();
                                }
                            }
                            // is peered
                            else {
                                that.fbRef.child('externalTempSensorIsPeered').set(true);
                                if (!upToDate) {

                                    that.unpeerVirtualSensor();
                                }
                            }
                            //if (that.extTempHasChanged) {
                                var newthis = that;
                                if (newthis.virtualTempInterval) {
                                    clearInterval(newthis.virtualTempInterval);
                                }
                                newthis.setExternalTemperature(newthis.extTemp);
                                newthis.virtualTempInterval = setInterval(function() {
                                    newthis.setExternalTemperature(newthis.extTemp);
                                },2*60*1000);
                                
                            //}

                            //if (Math.abs(parseFloat(that.extTemp) - parseFloat(that.trvTemp)) < 1) {
                            that.fbRef.child('usesExternalTemp').set(true);
                            //} else {
                            //    that.fbRef.child('usesExternalTemp').set(false);
                            //}


                            if (upToDate && that.extTempTimer) {
                                // log.info({
                                //     host: hostname
                                // }, 'Clearing unpeering timer for ' + that.id);
                                clearTimeout(that.extTempTimer);
                            }

                            if (that.isPeered) {
                                // log.info({
                                //     host: hostname
                                // }, 'Setting unpeering timer for ' + that.id);
                                that.extTempTimer = setTimeout(function(self) {
                                    self.unpeerVirtualSensor();
                                }, 32 * 60 * 1000, that);
                            }
                        } else {

                            log.warn({
                                host: hostname
                            }, error);

                        }

                    });

                } else {

                    log.warn({
                        host: hostname
                    }, error);

                }

            });

        }

    }, this);

}

Thermostat.prototype.activateBurst = function() {
    log.info({
        host: hostname,
        thermostat: this.id
    }, 'Activate burst mode for ' + this.id);
    fhem.write('set ' + this.id +
        ' regSet burstRx on\n');
};

Thermostat.prototype.getConfig = function() {
    log.info({
        host: hostname,
        thermostat: this.id
    }, 'Reading configuration registers ' + this.id);
    fhem.write('set ' + this.id + '_Clima getConfig\n');
};

Thermostat.prototype.hasExternalTempSensor = function(cb) {
    fhem.doesDeviceExist('extTemp_' + this.id, cb);
};

Thermostat.prototype.getPeeredSensor = function(cb) {
    fhem.getPeeredSensor(this.id + '_Weather', cb);
    //fhem.write('set ' + this.id + '_Weather getConfig\n');
};

Thermostat.prototype.peerVirtualSensor = function() {
    log.info({
        host: hostname,
        thermostat: this.id
    }, 'Peering virtual temperature sensor with ' + this.id);
    fhem.write('set extTemp_' + this.id + '_Btn1 peerChan 0 ' + this.id + ' single\n');
    fhem.write('set ' + this.id + '_Weather getConfig\n');
};

Thermostat.prototype.unpeerVirtualSensor = function() {
    log.info({
        host: hostname,
        thermostat: this.id
    }, 'Unpeering virtual temperature sensor from ' + this.id);
    fhem.write('set ' + this.id + '_Weather peerBulk ' + this.peeredSensor + ' unset\n');
    fhem.write('set ' + this.id + '_Weather getConfig\n');
};

Thermostat.prototype.defineVirtualSensor = function() {
    var address = Math.floor((Math.random() * 999999) + 1);
    this.virtualSensor = address;
    fhem.write('define extTemp_' + this.id + ' CUL_HM ' + address + '\n');
    fhem.write('set extTemp_' + this.id + ' virtual 1\n');
    fhem.write('save\n');
};

Thermostat.prototype.setExternalTemperature = function(temperature) {
    log.info({
        host: hostname,
        thermostat: this.id
    }, 'Set virtual temperature sensor for ' + this.id + ' with ' + temperature);
    fhem.write('set extTemp_' + this.id + '_Btn1 virtTemp ' + temperature + '\n');
};

Thermostat.prototype.deactivateWindowOpnMode = function() {
    log.info({
        host: hostname,
        thermostat: this.id
    }, 'Deactivate window open mode for ' + this.id);
    fhem.write('set ' + this.id + '_Clima regSet winOpnMode off\n');
    setTimeout(function() {
        fhem.write('set ' + this.id + '_Clima getConfig\n');
    }, 2 * 60 * 1000);
};

Thermostat.prototype.setWindowOpnTemp = function(temp) {
    log.info({
        host: hostname,
        thermostat: this.id
    }, 'Set window open temperature to' + temp);
    fhem.write('set ' + this.id + '_Clima regSet winOpnTemp ' + temp + '\n');
};

Thermostat.prototype.setWindowOpnPeriod = function(period) {
    log.info({
        host: hostname,
        thermostat: this.id
    }, 'Set window open period to' + period);
    fhem.write('set ' + this.id + '_Clima regSet winOpnPeriod ' + period + '\n');
};

Thermostat.prototype.watch = function(property, interval) {
    var dummyFn;
    var propertyFn = 'get' + property.capitalize();
    var self = this;
    (dummyFn = function() {
        fhem[propertyFn](self.id, function(err, value) {
            if (!err) {
                if (typeof value != 'undefined') {
                    if (property === 'burstRx' && (value.Value === 'off' || value.Value === 'off ')) {
                        self.activateBurst();
                    } else if (property === 'windowOpnMode') {
                        var time = new Date(value.Time);
                        var now = Date.now();
                        if (value.Value === 'on' || value.Value === 'on ') {
                            self.deactivateWindowOpnMode();
                        } else if (now - time > 4 * 60 * 60 * 1000) {
                            log.info({
                                host: hostname,
                                Thermostat: self.id
                            }, 'Reading configuration registers  because windowOpenRegister older than 4 hours');
                            self.getConfig();
                        }
                    } else if (property === 'windowOpnPeriod') {
                        if (value.Value + '' === '15 min') {
                            self.setWindowOpnPeriod(0);
                        }
                        else if (value.Value + '' === '0 min') {
                            clearInterval(self.intervals.windowOpnPeriod);
                        }
                    } else if (property === 'windowOpnTemp') {
                        if (value.Value + '' === '12 C') {
                            self.setWindowOpnTemp(21);
                        }
                        else if (value.Value + '' === '21 C') {
                            clearInterval(self.intervals.windowOpnTemp);
                        }
                    }
                    self.fbRef.child(property).set(value);
                } else {
                    log.warn({
                        host: hostname,
                        thermostat: self.id
                    }, 'Thermostat.js: ' + property + ' is undefined');
                }
            } else {
                //log.warn(err);
            }
        });
    })();
    self.intervals[property] = setInterval(dummyFn, interval);
};

Thermostat.prototype.unwatchAll = function() {
    var self = this;
    var intervals = self.intervals;
    for (var k in intervals) {
        if (intervals.hasOwnProperty(k)) {
            clearInterval(intervals[k]);
        }
    }
};

Thermostat.prototype.setFbRefOff = function() {
    this.fbRef.child('fhem_measured-temp').off();
    this.fbRef.child('target').off();
    this.fbRef.child('fhem_desired-temp').off();
    this.fbRef.child('externalTemperature').off();
    this.fbRef.child('state').off();
};

String.prototype.capitalize = function() {
    return this.charAt(0).toUpperCase() + this.slice(1);
};

module.exports = Thermostat;