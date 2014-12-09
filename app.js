/*jslint node: true */
'use strict';

var pjson = require('./package.json');
var version = pjson.version;

var Q = require('q');
var os = require('os');
var Firebase = require('firebase');
var request = require('request');

var config = require('./config');
var init = require('./lib/init');
var fhem = require('./lib/fhem');

var Thermostat = require('./lib/thermostat.js');

var bunyan = require('bunyan')
var bunyanLogentries = require('bunyan-logentries')

var hostname = os.hostname();


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
})

var homeId = null;
var fbHomeRef = null;
var fbGatewayRef = null;

var HOST = config.HOST;
var HTTPPORT = config.HTTPPORT;

var fbRef = new Firebase(config.firebase + '/gateways');

// Always check for version updates
fbRef.child('version').on('value', function(fbNewVersion) {
    log.info({
        host: hostname
    }, "App.js: Check for Update");
    if (fbNewVersion) {
        var newVersion = fbNewVersion.val();
        if (newVersion) {
            if (newVersion !== version) {
                log.info({
                    host: hostname
                }, "App.js: New version " + newVersion + " available (currently: " + version + "). Starting update... ");
                var exec = require('child_process').exec;
                var child = exec('git pull');
                child.stdout.on('data', function(data) {
                    log.info({
                        host: hostname
                    }, "App.js: Update procedure: " + data);
                });
                child.stderr.on('data', function(data) {
                    log.warn({
                        host: hostname
                    }, "App.js: Update procedure error: " + data);
                });
            }
        }
    }
});

// Start initializing
init.getGatewayId(fbRef)
    .then(function(gatewayId) {
        // Send a heartbeat to firebase every 60s
        fbGatewayRef = fbRef.child(gatewayId);
        heartbeat(60000);
        // watchUpdates(fbGatewayRef);
        // fhem.initHMDevice(fbGatewayRef);
        listenForPairing();
        return init.getHomeId(fbRef, gatewayId);
    })
    .then(function(home) {
        homeId = home;
        log.info({
            host: hostname,
            home: homeId
        }, "App.js: I'm belonging to home " + homeId);
        return getFbHomeRef(homeId);
    })
    .then(function(fbHomeRef) {
        fbHomeRef = fbHomeRef;
        // Listen for new thermostat data via telnet 
        fhem.listen(fbHomeRef);
        watchThermostats(fbHomeRef);

    }),
function(reason) {
    log.info({
        home: homeId
    }, reason);
};

function saveConfig() {
    log.info({
        host: hostname
    }, 'Saving fhem config');
    fhem.write('save\n');
}

// Regular saving of config
setInterval(saveConfig, 5 * 60 * 1000);


function watchThermostats(fbHomeRef) {

    /** Create and Delete Thermostats iff room has thermostats */
    /** Listen if thermostat is added to room **/

    var thermostats = {};
    fbHomeRef.child('thermostats').on('child_added', function(fbThermostat) {
        var fbThermostatRef = fbThermostat.ref();
        var thermostatId = fbThermostat.name();

        if (!fbThermostat.hasChild('room')) {
            fbThermostatRef.child('room').set('null');
        }

        //log.info({home: this.homeId, room: this.id}, ' Room: new Thermostat ' + thermostatId);
        thermostats[thermostatId] = new Thermostat(thermostatId, fbThermostatRef);
        // watch method also activates burst mode if deactivated
        thermostats[thermostatId].watch('burstRx', 15 * 60 * 1000);
        // watch method also deactivates window open mode if activated
        thermostats[thermostatId].watch('windowOpnMode', 5 * 60 * 1000);
        thermostats[thermostatId].watch('tempOffset', 24 * 60 * 60 * 1000);
        thermostats[thermostatId].watch('regAdaptive', 24 * 60 * 60 * 1000);
        thermostats[thermostatId].watch('pairedTo', 24 * 60 * 60 * 1000);
        //thermostats[thermostatId].watch('activity', 10 * 1000);
        //thermostats[thermostatId].watch('commandAccepted', 10 * 1000);
        thermostats[thermostatId].watch('btnLock', 24 * 60 * 60 * 1000);
        thermostats[thermostatId].watch('state', 10 * 1000);
        thermostats[thermostatId].watch('mode', 10 * 60 * 1000);

        if (fbThermostat.child('burstRX').child('Value').val() === 'off' || fbThermostat.child('burstRX').child('Value').val() === 'off ' || !fbThermostat.child('burstRX').child('Value').val()) {
            thermostats[thermostatId].activateBurst();
        }
        if (fbThermostat.child('windowOpnMode').child('Value').val() === 'on' || fbThermostat.child('windowOpnMode').child('Value').val() === 'on ') {
            thermostats[thermostatId].deactivateWindowOpnMode();
        }

    });



    /** Listen if thermostat is removed from room */
    fbHomeRef.child('thermostats').on('child_removed', function(fbThermostat) {
        log.info({
            host: hostname,
            home: homeId
        }, 'App.js: delete a thermostat');
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
    fbHomeRef = new Firebase(config.firebase + '/homes/' + homeId);
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
    // Activate pairing for 300s = 5min
    var period = 300;
    log.info({
        host: hostname,
        home: homeId
    }, 'App.js: Pairing activated for ' + period + 's');
    fhem.pairing(period);
    var retryTimer = setInterval(function() {
        request('http://' + HOST + ':' + HTTPPORT + '/fhem?cmd=jsonlist2%20hmusb&XHR=1', function(error, response, body) {
            if (!error && response.statusCode === 200) {
                var jsonObj = JSON.parse(body);
                //console.log((jsonObj.Results[0].Internals).hasOwnProperty('hmPair'));
                if ((jsonObj.Results[0].Internals).hasOwnProperty('hmPair')) {
                    fbGatewayRef.child('isPairing').set(true);
                } else {
                    fbGatewayRef.child('isPairing').set(false);
                    clearInterval(retryTimer);
                }
            }
        });
    }, 10 * 1000);
}

function heartbeat(frequency) {

    setInterval(function() {
        //log.info({ host: hostname, home: homeId},  "App.js: Heartbeat of " + homeId );
        fbGatewayRef.child('lastSeen').set(new Date().toString());
    }, frequency);

}