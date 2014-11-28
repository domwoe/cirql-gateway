/*jslint node: true */
'use strict';

var fhem = require('./fhem');
var os = require('os');


var bunyan = require('bunyan');
var bunyanLogentries = require('bunyan-logentries');

var hostname = os.hostname();

// create the logger
var log = bunyan.createLogger({
  name: "gateway",
  streams: [
    {
            stream: process.stdout,
            level: "info"
        },
    {
      level: 'info',
      stream: bunyanLogentries.createStream({token: '2f63e221-e11a-44e3-b5f3-3bd09a39bdc2'}),
      type: 'raw'
    }]
});

function Thermostat(id,fbRef) {
	this.id = id;
	this.fbRef = fbRef;
	this.intervals = {};
	this.target = null;
	this.waitForThermostat = false;
	this.retries = 1;

	fbRef.child('waitForThermostat').set(false);

	// Save serial number in firebase if there isn't
	// a serial number already
	fbRef.once('value', function(thermostatSnap) {
		if (!thermostatSnap.hasChild('serialNo')) {
			fhem.getSerialNo(id, function(err,value) {
				if (err) {
					log.warn(err);
				}
				else {
					fbRef.child('serialNo').set(value);
				}
			});
		}
	});


	// Listen to target changes on Firebase
	fbRef.child('target').on('value', function(target) {

		var target = parseFloat(target.val());

		// Get current target temperature of thermostat
		fbRef.child('fhem_desired-temp').once('value', function(fhemTarget) {

			var fhemTarget = parseFloat(fhemTarget.val());

			// Is new target defined and different from the current one?
			if (target !== this.target && target !== fhemTarget && typeof target != 'undefined' && !isNaN(target)) {

				log.info({host: hostname},'Thermostat.js: New target '+target+' for '+id);
				
				this.target = target;
				
				// Set target temperature at thermostat
				var setTarget;
				if ( this.setTargetInterval ) {
					clearInterval(this.setTargetInterval);
				}
				(setTarget = function() {
					fhem.setTarget(id,target);
				})();

				// Target change came from backend not from local user
				fbRef.child('manualChange').set(false);
				
				// This will be set to false as soon as the thermostat
				// has acknowledged the new target temperature
				this.waitForThermostat = true;
				fbRef.child('waitForThermostat').set(true);

				
				// Try again after 5min if there is now acknowledgement from
				// thermostat (max 3 retries)
				var self = this;
				this.setTargetInterval = setInterval(
					function() {
						if (self.retries <= 3) {			
							log.info({host: hostname},'Retry '+self.retries+' to set target of '+id);
							setTarget();
							self.retries++;	
						}
						else {
							log.warn({host: hostname},'Target of '+id+' could not be set. Stop retrying.');
							clearInterval( self.setTargetInterval );
							self.retries = 1;
						}
					}
				,5 * 60 * 1000);
			}
		},this);		
	},this);

	// Listen for changes of target at thermostat
	fbRef.child('fhem_desired-temp').on('value', function(fhemTarget) {
		var fhemTarget = parseFloat(fhemTarget.val());
		// Target writing was successful
		if (this.waitForThermostat === true && fhemTarget === this.target) {
			this.waitForThermostat = false;
			fbRef.child('waitForThermostat').set(false);
			clearInterval(this.setTargetInterval);
			this.retries = 1;
		}
		// Manual change at Thermostat
		else if (this.waitForThermostat === false && fhemTarget !== this.target && typeof fhemTarget != 'undefined' && !isNaN(fhemTarget)) {
			this.target = fhemTarget;
			fbRef.child('target').set(fhemTarget, function(error){
				if(error) {
					log.warn({host: hostname},'Thermostat.js: '+error);
				}
				else {
					fbRef.child('manualChange').set(true);
				}
			});
		}
	},this);

	fbRef.child('externalTemperature').on('value', function(extTempObj) {
		
		log.info({host: hostname},'Update from external temperature sensor for thermostat '+id);

		if (extTempObj.hasChild('timestamp') && extTempObj.hasChild('value') ) {
			
			var timestamp = extTempObj.child('timestamp').val();
			var extTemp = extTempObj.child('value').val();

        	var upToDate = ((Date.now() - (timestamp - 5000)) < 20 * 60 * 1000) ? true : false;
  

			var self = this;

			self.hasExternalTempSensor(function(error, hasSensor) {

				if (!error) {
					if (!hasSensor) {

						log.info({host: hostname},'Defining virtual temperature sensor for '+id);

						self.defineVirtualSensor();

					}
					
					self.isPeered(function(error, isPeered) {


						if (!error) {
							if (!isPeered) {
								if (upToDate) {

									log.info({host: hostname},'Peering virtual temperature sensor with '+id);

									self.peerVirtualSensor();
								}	
							}
							// is peered
							else {
								if (!upToDate) {

									log.info({host: hostname},'Unpeering virtual temperature sensor from '+id);

									self.unpeerVirtualSensor();
								}
							}

							self.setExternalTemperature(extTemp);
						}
						else {

							log.warn({host: hostname},error);

						}		

					});

				}
				else {

					log.warn({host: hostname},error);

				}

			});

		}
		
	}, this);


}

Thermostat.prototype.activateBurst = function() {
	fhem.write('set '+this.id+' regSet burstRx on\n');
};

Thermostat.prototype.hasExternalTempSensor = function(cb) {
	fhem.doesDeviceExist(cb);
};

Thermostat.prototype.isPeered = function(cb) {
	fhem.isPeered('extTemp_'+this.id+'_Btn1', cb);
};

Thermostat.prototype.peerVirtualSensor = function() {
	fhem.write('set extTemp_'+this.id+'_Btn1 peerChan 0 '+this.id+' single');
};

Thermostat.prototype.unpeerVirtualSensor = function() {
	fhem.write('set '+this.id+'_Weather peerBulk extTemp_'+this.id+'_Btn1 unset');
};

Thermostat.prototype.defineVirtualSensor = function() {
	var address = Math.floor((Math.random() * 999999) + 1);
	fhem.write('define extTemp_'+this.id+' CUL_HM '+address+'\n');
	fhem.write('set extTemp_'+this.id+' virtual 1\n');
};

Thermostat.prototype.setExternalTemperature = function(temperature) {
	fhem.write('set extTemp_'+this.id+'_Btn1 virtTemp '+temperature+'\n');
};

Thermostat.prototype.deactivateWindowOpnMode = function() {
	fhem.write('set '+this.id+'_Clima regSet winOpnMode off\n');
};

Thermostat.prototype.watch = function(property,interval) {
	var dummyFn;
	var propertyFn = 'get'+property.capitalize();
	var self = this;
	(dummyFn = function() {
		fhem[propertyFn](self.id,function(err,value) {
			if (!err) {
				if (typeof value != 'undefined') {
					if (property === 'burstRx' && value.Value !== 'on') {
						self.activateBurst();
					}
					else if (property === 'windowOpnMode' && value.Value !== 'off') {
						self.deactivateWindowOpnMode();
					}
					self.fbRef.child(property).set(value);
				}
				else {
					log.warn({host: hostname},'Thermostat.js: '+ property +' is undefined');
				}	
			}
			else {
				log.warn(err);
			}	
		});
	})();		
	self.intervals[property] = setInterval(dummyFn,interval);
};

Thermostat.prototype.unwatchAll = function() {
	var self = this;
	var intervals = self.intervals;
	for(var k in intervals) {
		if (intervals.hasOwnProperty(k)) {
			clearInterval(intervals[k]);
		}
	}
};

String.prototype.capitalize = function() {
    return this.charAt(0).toUpperCase() + this.slice(1);
};

module.exports = Thermostat;