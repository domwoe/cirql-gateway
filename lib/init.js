/**
 * Initialization routine 
 *
 */
/*jslint node: true */
'use strict';

var os = require('os');

var Q = require('q'); 

var hostname = os.hostname();
var home = false;

var bunyan = require('bunyan');
var bunyanLogentries = require('bunyan-logentries');


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

exports.getGatewayId = function(fbRef) {
	var deferred = Q.defer();
	require('getmac').getMac(function(err,macAddress) {
	    if (err)  {
	    	deferred.reject(new Error(err));
	    }
	    else {
	    	log.info({host: hostname}, 'My MAC address is '+macAddress);
	    	fbRef.once('value', function(gateways) {

	    		if (gateways.hasChild(hostname)) {

	    			deferred.resolve(hostname);

	    		}
	    		else if (gateways.hasChild(macAddress)) {

	    			deferred.resolve(macAddress);
	    		}
	    		else {

	    			// Register gateway
					fbRef.child(hostname).child('gatewayId').set(hostname);
					deferred.resolve(hostname);	

	    		}
			});
		}
	});
	return deferred.promise;
};

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
	var homeInterval = (function() {setInterval(dummyFn,60*1000);})();	
	return deferred.promise;	
};
