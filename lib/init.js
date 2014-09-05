/**
 * Initialization routine 
 *
 */

'use strict';


var Q = require('q'); 
var Firebase = require('Firebase');
var config = require('../config');

var fbRef = new Firebase(config.firebase+'/gateways');

// Checks if gateway is registered and returns home id if available
exports.getHome = function() {
	// Get MAC address
	var deferred = Q.defer();
	require('getmac').getMac(function(err,macAddress){
	    if (err)  {
	    	deferred.reject(new Error(err));
	    }
	    else {
	    	var home = null;
	    	fbRef.once('value', function(gateways) {

				if (gateways.hasChild(macAddress)) {
					// check if gateway is already connected to an account
					if (gateways.child(macAddress).hasChild('homeId')) {
						var home = gateways.child(macAddress).child('homeId').val();
						deferred.resolve(home);
					}
				}	
				// Register gateway
				else {
					fbRef.child(macAddress).child('gatewayId').set(macAddress)			
				}
				deferred.resolve(home);
			});
	    }
	});
	return deferred.promise;

};




