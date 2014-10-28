/*jslint node: true */
'use strict';

var Q = require('q');
var Firebase = require('firebase');
var request = require('request');

var config = require('./config');
var init = require('./lib/init');
var fhem = require('./lib/fhem');

var Thermostat = require('./lib/thermostat.js');

var bunyan = require('bunyan');
var log = bunyan.createLogger({name: 'cirql-gateway'});

var homeId = null;
var fbHomeRef = null;
var fbGatewayRef = null;

var HOST = config.HOST;
var HTTPPORT = config.HTTPPORT;

var fbRef = new Firebase(config.firebase+'/gateways');
// Start initializing
init.getGatewayId(fbRef)
	.then(function(gatewayId) {
		// Send a heartbeat to firebase every 60s
		fbGatewayRef = fbRef.child(gatewayId);
		heartbeat(60000);
		listenForPairing();
		return init.getHomeId(fbRef,gatewayId);
	})	
	.then(function(home) {
		homeId = home;
		log.info({home: homeId},  "App.js: I'm belonging to home " + homeId );
		return getFbHomeRef(homeId);
	})
	.then(function(fbHomeRef) {
		fbHomeRef = fbHomeRef;
		// Listen for new thermostat data via telnet 
		fhem.listen(fbHomeRef);
		watchThermostats(fbHomeRef);
	}),
	function(reason) {
		log.info({home: homeId}, reason);
	};

function watchThermostats(fbHomeRef) {
  /** Create and Delete Thermostats iff room has thermostats */
  /** Listen if thermostat is added to room **/
  var thermostats = {};
  fbHomeRef.child('thermostats').on('child_added', function(fbThermostat) {
  	var fbThermostatRef = fbThermostat.ref();
    var thermostatId = fbThermostat.name();
    //log.info({home: this.homeId, room: this.id}, ' Room: new Thermostat ' + thermostatId);
   thermostats[thermostatId] = new Thermostat(thermostatId,fbThermostatRef);
   thermostats[thermostatId].watch('pairedTo',60*60*1000);
   thermostats[thermostatId].watch('activity',10*1000);
   thermostats[thermostatId].watch('commandAccepted',10*1000);
   thermostats[thermostatId].watch('btnLock',5*60*1000);
   thermostats[thermostatId].watch('burstRx',10*1000);
   thermostats[thermostatId].watch('state',10*1000);
   thermostats[thermostatId].watch('mode',10*1000);
  });

  /** Listen if thermostat is removed from room */
  fbHomeRef.child('thermostats').on('child_removed', function(fbThermostat) {
    log.info({home: homeId},'delete a thermostat');
    var id = fbThermostat.name();
    var thermostatObj = thermostats[id];

    if (thermostatObj) {
      //log.info({home: this.homeId, room: this.id}, ' Room: delete Thermostat with id: '+id);
      thermostatObj.unwatchAll();
      thermostatObj.setFbRefOff();
      delete thermostats[id];
    }
  });
}

function setFbRefOff() {
	fbRef.off();
}

function getFbHomeRef(homeId) {
	var deferred = Q.defer();
	fbHomeRef = new Firebase(config.firebase+'/homes/'+homeId);
	deferred.resolve(fbHomeRef);
	return deferred.promise;
}

function listenForPairing() {
	fbGatewayRef.child('activatePairing')
		.on('value', function(snap) {
			var activatePairing = snap.val();
			if (activatePairing) {
				setPairing();
				fbGatewayRef
					.child('activatePairing')
					.set(false);
			}
		});
}

function setPairing() {
	// Activate pairing for 180s = 3min
	var period = 180;
	log.info({home: homeId},  'App.js: Pairing activated for '+period+'s');
	fhem.pairing(period);
	var retryTimer = setInterval(function() {
		request('http://'+HOST+':'+HTTPPORT+'/fhem?cmd=jsonlist2%20hmusb&XHR=1', function (error, response, body) {
  			if (!error && response.statusCode == 200) {
  				var jsonObj = JSON.parse(body);
  				//console.log((jsonObj.Results[0].Internals).hasOwnProperty('hmPair'));
  				if ((jsonObj.Results[0].Internals).hasOwnProperty('hmPair')){
  					fbGatewayRef.child('isPairing').set(true);	
  				}
  				else {
  					fbGatewayRef.child('isPairing').set(false);
  					clearInterval(retryTimer);	
  				}
  			}
		});
	},10*1000);
}
function heartbeat(frequency) {
	setInterval(function() {
		fbGatewayRef.child('lastSeen').set(new Date().toString());
	},frequency);
}
