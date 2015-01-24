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
    this.trvTemp;
    this.extTemp;

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
                    clearInterval(this.setTargetInterval);
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

                // Thermostat is waiting max 15min.
                // setTimeout(function() {
                //     if (self.waitForThermostat === true) {
                //         self.waitForThermostat = false;
                //         self.fbRef.child('waitForThermostat').set(false);
                //     }

                // }, 15 * 60 * 1000);


                // Try again after 5min if there is now acknowledgement from
                // thermostat (max 3 retries)
                (function retry() {
                    this.setTargetInterval = setTimeout(
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
                            } else {
                                log.warn({
                                    host: hostname,
                                    thermostat: self.id
                                }, 'Target of ' + id + ' could not be set. Stop retrying.');
                                clearInterval(self.setTargetInterval);
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
            clearInterval(this.setTargetInterval);
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
                        host: hostname
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
            var extTemp = extTempObj.child('value').val();

            var upToDate = ((Date.now() - timestamp) < 30 * 60 * 1000) ? true : false;

            log.info({
                host: hostname
            }, 'Update from external temperature sensor for thermostat ' + id + ' Up to date: ' + upToDate);

            var self = this;

            self.hasExternalTempSensor(function(error, hasSensor) {

                if (!error) {

                    self.fbRef.child('hasExternalTempSensor').set(true);
                    if (!hasSensor) {

                        self.fbRef.child('hasExternalTempSensor').set(false);

                        log.info({
                            host: hostname
                        }, 'Defining virtual temperature sensor for ' + self.id);

                        self.defineVirtualSensor();

                    }

                    var that = self;

                    that.isPeered(function(error, isPeered) {

                        log.info({
                            host: hostname
                        }, 'virtual sensor for ' + that.id + ' peered ? ' + isPeered);

                        if (!error) {
                            if (!isPeered) {
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

                            that.setExternalTemperature(extTemp);

                            if (Math.abs(parseFloat(extTemp) - parseFloat(that.trvTemp)) < 1) {
                                that.fbRef.child('usesExternalTemp').set(true);
                            } else {
                                that.fbRef.child('usesExternalTemp').set(false);
                            }


                            if (upToDate && that.extTempTimer) {
                                // log.info({
                                //     host: hostname
                                // }, 'Clearing unpeering timer for ' + that.id);
                                clearTimeout(that.extTempTimer);
                            }

                            if (isPeered) {
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
        host: hostname
    }, 'Activate burst mode for ' + this.id);
    fhem.write('set ' + this.id +
        ' regSet burstRx on\n');
};

Thermostat.prototype.getConfig = function() {
    log.info({
        host: hostname
    }, 'Reading configuration registers ' + this.id);
    fhem.write('set ' + this.id + '_Clima getConfig\n');
};

Thermostat.prototype.hasExternalTempSensor = function(cb) {
    fhem.doesDeviceExist('extTemp_' + this.id, cb);
};

Thermostat.prototype.isPeered = function(cb) {
    fhem.isPeered(this.id + '_Weather', cb);
    //fhem.write('set ' + this.id + '_Weather getConfig\n');
};

Thermostat.prototype.peerVirtualSensor = function() {
    log.info({
        host: hostname
    }, 'Peering virtual temperature sensor with ' + this.id);
    fhem.write('set extTemp_' + this.id + '_Btn1 peerChan 0 ' + this.id + ' single\n');
    fhem.write('set ' + this.id + '_Weather getConfig\n');
};

Thermostat.prototype.unpeerVirtualSensor = function() {
    log.info({
        host: hostname
    }, 'Unpeering virtual temperature sensor from ' + this.id);
    fhem.write('set ' + this.id + '_Weather peerBulk extTemp_' + this.id + '_Btn1 unset\n');
    fhem.write('set ' + this.id + '_Weather getConfig\n');
};

Thermostat.prototype.defineVirtualSensor = function() {
    var address = Math.floor((Math.random() * 999999) + 1);
    fhem.write('define extTemp_' + this.id + ' CUL_HM ' + address + '\n');
    fhem.write('set extTemp_' + this.id + ' virtual 1\n');
};

Thermostat.prototype.setExternalTemperature = function(temperature) {
    log.info({
        host: hostname
    }, 'Set virtual temperature sensor for ' + this.id + ' with ' + temperature);
    fhem.write('set extTemp_' + this.id + '_Btn1 virtTemp ' + temperature + '\n');
};

Thermostat.prototype.deactivateWindowOpnMode = function() {
    log.info({
        host: hostname
    }, 'Deactivate window open mode for ' + this.id);
    fhem.write('set ' + this.id + '_Clima regSet winOpnMode off\n');
    setTimeout(function() {
        fhem.write('set ' + this.id + '_Clima getConfig\n');
    }, 10 * 60 * 1000);
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
                    }
                    self.fbRef.child(property).set(value);
                } else {
                    log.warn({
                        host: hostname
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
};

String.prototype.capitalize = function() {
    return this.charAt(0).toUpperCase() + this.slice(1);
};

module.exports = Thermostat;