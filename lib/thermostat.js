/**
 * Thermostat
 *
 */

'use strict';

var fhem = require('./fhem');

function Thermostat(id,fbRef) {
	this.id = id;
	this.fbRef = fbRef;
	this.intervals = {};
	this.target = null;
	this.waitForThermostat = false;

	// Save serial number in firebase if there isn't
	// a serial number already
	fbRef.once('value', function(thermostatSnap) {
		if (!thermostatSnap.hasChild('serialNo')) {
			fhem.getSerialNo(id, function(err,value) {
				if (err) {
					console.log(err);
				}
				else {
					fbRef.child('serialNo').set(value);
				}
			});
		}
	});

	fbRef.child('target').on('value', function(target) {
		var target = parseFloat(target.val());
		fbRef.child('fhem_desired-temp').once('value', function(fhemTarget) {
			var fhemTarget = parseFloat(fhemTarget.val());
			if (target !== this.target && target !== fhemTarget && typeof target != 'undefined' && !isNaN(target)) {
				console.log('New target '+target+' for '+id);
				this.target = target;
				var setTarget;
				(setTarget = function() {
					fhem.setTarget(id,target);
				})
				fbRef.child('manualChange').set(false);
				this.waitForThermostat = true;
				fbRef.child('waitForThermostat').set(true);
				this.setTargetInterval = setInterval(setTarget,3*60*1000);
			}
		},this);		
	},this);

	fbRef.child('fhem_desired-temp').on('value', function(fhemTarget) {
		var fhemTarget = parseFloat(fhemTarget.val());
		// Target writing was successful
		if (this.waitForThermostat === true && fhemTarget === this.target) {
			this.waitForThermostat = false;
			fbRef.child('waitForThermostat').set(false);
			clearInterval(this.setTargetInterval);
		}
		// Manual change at Thermostat
		else if (this.waitForThermostat === false && fhemTarget !== this.target) {
			this.target = fhemTarget;
			fbRef.child('target').set(fhemTarget);
			fbRef.child('manualChange').set(true);
		}
	},this);
}

Thermostat.prototype.watch = function(property,interval) {
	var dummyFn;
	var propertyFn = 'get'+property.capitalize();
	var self = this;
	(dummyFn = function() {
		fhem[propertyFn](self.id,function(err,value) {
			if (!err) {
				if (typeof value != 'undefined') {
					self.fbRef.child(property).set(value);
				}
				else {
					console.log(property +' is undefined');
				}	
			}
			else {
				console.log(err);
			}	
		});
	})();		
	self.intervals[property] = setInterval(dummyFn,interval);
}

Thermostat.prototype.unwatchAll = function() {
	var self = this;
	var intervals = self.intervals;
	for(var k in intervals) {
		if (intervals.hasOwnProperty(k)) {
			clearInterval(intervals[k]);
		}
	}
}

String.prototype.capitalize = function() {
    return this.charAt(0).toUpperCase() + this.slice(1);
}

module.exports = Thermostat;