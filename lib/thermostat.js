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

	// Save serial number in firebase if there isn't
	// a serial number already
	fbRef.once('value', function(thermostatSnap) {
		if (!thermostatSnap.hasChild('serialNo')) {
			fhem.serialNo(id, function(err,value) {
				if (err) {
					console.log(err);
				}
				else {
					fbRef.child('serialNo').set(value);
				}
			});
		}
	});
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
};

String.prototype.capitalize = function() {
    return this.charAt(0).toUpperCase() + this.slice(1);
}

module.exports = Thermostat;