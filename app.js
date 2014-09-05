
'use strict';

var Q = require('q');
var Firebase = require('Firebase');
var config = require('./config');
var init = require('./lib/init');

var homeId = null;
var fbHomeRef = null;

init.getHome()
	.then(function(id) {
		homeId = id;
		return getFbHomeRef(homeId)
	})
	.then(function(fbHomeRef) {
		listenForPairing(fbHomeRef)
	}),
	function(reason) {
		console.log(reason);
	};


function getFbHomeRef(homeId) {
	console.log(homeId);
	var deferred = Q.defer();
	fbHomeRef = new Firebase(config.firebase+'/homes/'+homeId);
	deferred.resolve(fbHomeRef);
	return deferred.promise;
};

function listenForPairing(fbHomeRef) {
	fbHomeRef.child('gateway')
		.child('activatePairing')
		.on('value', function(snap) {
			var activatePairing = snap.val();
			if (activatePairing) {
				setPairing();
				fbHomeRef.child('gateway')
					.child('activatePairing')
					.set(false);
			}
		});
};

function setPairing() {
	client.write('set hmusb hmPairForSec 180\n');
	var retryTimer = setInterval(function() {
		request('http://'+HOST+':8083/fhem?cmd=jsonlist2%20hmusb&XHR=1', function (error, response, body) {
  			if (!error && response.statusCode == 200) {
  				var gatewayRef = fbHomeRef.child('gateway');
  				var jsonObj = JSON.parse(body);
  				console.log((jsonObj.Results[0].Internals).hasOwnProperty('hmPair'));
  				if ((jsonObj.Results[0].Internals).hasOwnProperty('hmPair')){
  					gatewayRef.child('isPairing').set(true);	
  				}
  				else {
  					gatewayRef.child('isPairing').set(false);
  					clearInterval(retryTimer);	
  				}
  			}
		})
	},10*1000)
}
