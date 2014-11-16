/**
 * Initialization routine 
 *
 */

'use strict';


var Q = require('q'); 
var Firebase = require('firebase');
var config = require('../config');

var home = false;

exports.getGatewayId = function(fbRef) {
	var deferred = Q.defer();
	require('getmac').getMac(function(err,macAddress) {
	    if (err)  {
	    	deferred.reject(new Error(err));
	    }
	    else {
	    	console.log('My MAC address is '+macAddress);
	    	fbRef.once('value', function(gateways) {

				if (!gateways.hasChild(macAddress)) {
					// Register gateway
					fbRef.child(macAddress).child('gatewayId').set(macAddress);			
				}
			});
	    	deferred.resolve(macAddress);
		}
	});
	return deferred.promise;
}

// function hasHome(fbRef,gatewayId) {
// 	var deferred = Q.defer();
// 	console.log(fbRef.hasChild(gatewayId));
// 	if (fbRef.hasChild(gatewayId)) {
// 		console.log(true);
// 		deferred.resolve(true);
// 	}
// 	else {
// 		console.log(false);
// 		deferred.resolve(false);
// 	}
// 	return deferred.promise;	
// }

exports.getHomeId = function(fbRef,gatewayId) {
	var deferred = Q.defer();
	var dummyFn;
	(dummyFn = function() {
		fbRef.child(gatewayId).once('value',function(gatewaySnap) {
			if(gatewaySnap.hasChild('homeId')) {
				var homeId = gatewaySnap.child('homeId').val();
				deferred.resolve(homeId);
				if (typeof homeInterval != 'undefined') {
					clearInterval(homeInterval);
				}
			}
		});
	})();
	var homeInterval = (function() {setInterval(dummyFn,60*1000)})();	
	return deferred.promise;	
}
