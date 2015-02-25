/*jslint node: true */
'use strict';

var net = require('net');
var request = require('request');

var os = require('os');
var config = require('../config.json');
var HOST = config.HOST;
var HTTPPORT = config.HTTPPORT;
var NETPORT = config.NETPORT;

var client = new net.Socket();

var fbHomeRefBuffer = null;

var hostname = os.hostname();

var bunyan = require('bunyan');
var bunyanLogentries = require('bunyan-logentries');


var log = bunyan.createLogger({
    name: 'gateway',
    streams: [{
        stream: process.stdout,
        level: 'info'
    }, {
        level: 'info',
        stream: bunyanLogentries.createStream({
            token: '2f63e221-e11a-44e3-b5f3-3bd09a39bdc2'
        }),
        type: 'raw'
    }]
});

var hmDevice = 'hmusb';

var wait = 0;

function write(msg) {
    if (client.writable) {
        wait++;
        var timeout = wait > 1 ? wait-1 : 0;
        console.log('WAIT: ' + wait);
            setTimeout(function() {
                client.write(msg);
                wait = wait > 0 ? wait-1 : 0;
            },5000*timeout);
    } else {
        client.connect(NETPORT, HOST, function() {
            client.write(msg);
        });
    }
}

function listen(fbHomeRef) {
    if (typeof fbHomeRef !== 'undefined') {
        fbHomeRefBuffer = fbHomeRef;
    } else {
        fbHomeRef = fbHomeRefBuffer;
    }
    var fbThermostatRef = fbHomeRef.child('thermostats');

    log.info({
        host: hostname
    }, 'Start listening to fhem...');

    // Subscribe to all fhem events 
    write('inform timer\n');

    client.on('data', function(data) {
        //log.info('yeah, data coming!');
        // Parse fhem data
        data = data.toString();
        var lines = data.split('\n');
        lines = lines.map(function(line) {
            return line.split(' ');
        });
        for (var i = 0; i < lines.length; i++) {
            var line = lines[i];
            if (line.length > 5) {
                var fhemDeviceName = line[3];
                var fhemAttribute = line[4];
                var re = new RegExp(/([A-Z,0-9])\b/);

                // fhemDevice is thermostat
                if (fhemDeviceName.indexOf('HM_CC_RT_DN') > -1 && fhemDeviceName[0] !== 'e') {
                    if (re.test(fhemDeviceName)) {
                        var thermostatId = fhemDeviceName;
                        var thermostatRef = fbThermostatRef.child(thermostatId);
                        thermostatRef.child('fhem_name').set(fhemDeviceName);
                        thermostatRef.child('lastSeen').set(new Date().toString());
                        if (fhemAttribute[fhemAttribute.length - 1] === ':' && fhemAttribute !== 'T:') {
                            fhemAttribute = fhemAttribute.slice(0, fhemAttribute.length - 1);
                            var fhemAttributeValue = line[5];
                            if (fhemAttribute === 'desired-temp') {
                                if (fhemAttributeValue === 'off') {
                                    fhemAttributeValue = 5;
                                } else if (fhemAttributeValue === 'on') {
                                    fhemAttributeValue = 30;
                                }
                            }
                        thermostatRef.child('fhem_' + fhemAttribute).set(fhemAttributeValue);
                        }
                    }

                }
            }


        }
        //Close the client socket completely
        //client.destroy();

    });
}

// Error should be emitted and caught by
// the calling module. To make this hack work
// fbHomeRefBuffer was introduced
client.on('error', function(err) {
    log.warn({
        host: hostname
    }, ' FHEM-Error: ' + err);
    listen();
});


// Commented out because of problems and function is not really needed
//function initHMDevice(fbGateWayref) {
// if (fbGateWayref.child('hmDevice')) {
//     hmDevice = fbGateWayref.child('hmDevice');
// }
// else {
//     reqHttpApi('CUL','Name',null,function(err,value) {
//         if (!err && value) {
//          hmDevice = value;
//          fbGateWayref.child('hmDevice').set(value);   
//         }
//     });
// }
//}

function pairing(period) {
    write('set ' + hmDevice + ' hmPairForSec ' + period + '\n');
}

function setTarget(device, target) {
    write('set ' + device + '_Clima controlManu ' + target + '\n');
    write('set ' + device + ' burstXmit\n');
}

function reqHttpApi(device, propertyLoc, property, callback) {
    request('http://' + HOST + ':' + HTTPPORT + '/fhem?cmd=jsonlist2%20' + device + '&XHR=1', function(error, response, body) {
        if (!error && response.statusCode === 200) {
            try {
                var jsonObj = JSON.parse(body);
                var value = (jsonObj.Results[0])[propertyLoc][property];
                callback(null, value);
            } catch (e) {
                callback(e, null);
            }
        } else {
            callback(error, null);
        }
    });
}

function getHmId(callback) {
    reqHttpApi('hmusb', 'Attributes', 'hmId', function(err, value) {
        if (err) {
            callback(err, null);
        } else {
            console.log(value);
            callback(null, value);
        }
    });
}

function setHmId() {
    var hmId = '';
    for (var i = 0; i < 6; i++) {
        var hexNumber = Math.floor((Math.random() * 15)).toString(16);
        hmId += hexNumber;
    }
    write('attr hmusb hmId ' + hmId.toUpperCase() + '\n');
    write('save\n');

}

function getSerialNo(device, callback) {
    reqHttpApi(device, 'Attributes', 'serialNr', function(err, value) {
        if (err) {
            callback(err, null);
        } else {
            callback(null, value);
        }
    });
}

function getPairedTo(device, callback) {
    reqHttpApi(device, 'Readings', 'PairedTo', function(err, value) {
        if (err) {
            callback(err, null);
        } else {
            callback(null, value);
        }
    });
}

function getActivity(device, callback) {
    reqHttpApi(device, 'Readings', 'Activity', function(err, value) {
        if (err) {
            callback(err, null);
        } else {
            callback(null, value);
        }
    });
}

function getCommandAccepted(device, callback) {
    reqHttpApi(device, 'Readings', 'CommandAccepted', function(err, value) {
        if (err) {
            callback(err, null);
        } else {
            callback(null, value);
        }
    });
}

function getBtnLock(device, callback) {
    reqHttpApi(device, 'Readings', 'R-btnLock', function(err, value) {
        if (err) {
            callback(err, null);
        } else {
            callback(null, value);
        }
    });
}

function getBurstRx(device, callback) {
    reqHttpApi(device, 'Readings', 'R-burstRx', function(err, value) {
        if (err) {
            callback(err, null);
        } else {
            callback(null, value);
        }
    });
}

function getWindowOpnMode(device, callback) {
    reqHttpApi(device + '_Clima', 'Readings', 'R-winOpnMode', function(err, value) {
        if (err) {
            callback(err, null);
        } else {
            callback(null, value);
        }
    });
}

function getWindowOpnTemp(device, callback) {
    reqHttpApi(device + '_Clima', 'Readings', 'R-winOpnTemp', function(err, value) {
        if (err) {
            callback(err, null);
        } else {
            callback(null, value);
        }
    });
}

function getWindowOpnPeriod(device, callback) {
    reqHttpApi(device + '_Clima', 'Readings', 'R-winOpnPeriod', function(err, value) {
        if (err) {
            callback(err, null);
        } else {
            callback(null, value);
        }
    });
}

function getTempOffset(device, callback) {
    reqHttpApi(device + '_Clima', 'Readings', 'R-tempOffset', function(err, value) {
        if (err) {
            callback(err, null);
        } else {
            callback(null, value);
        }
    });
}

function getRegAdaptive(device, callback) {
    reqHttpApi(device + '_Clima', 'Readings', 'R-regAdaptive', function(err, value) {
        if (err) {
            callback(err, null);
        } else {
            callback(null, value);
        }
    });
}

function setRegAdaptive(device, value) {
    
    write('set ' + device + '_Clima regSet regAdaptive ' + value + '\n');

}

function getRegExtI(device, callback) {
    reqHttpApi(device + '_Clima', 'Readings', 'R-reguExtI', function(err, value) {
        if (err) {
            callback(err, null);
        } else {
            callback(null, value);
        }
    });
}

function setRegExtI(device, value) {
    
    write('set ' + device + '_Clima regSet reguExtI ' + value + '\n');

}

function setRegExtP(device, value) {
    
    write('set ' + device + '_Clima regSet reguExtP ' + value + '\n');

}


function getRegExtP(device, callback) {
    reqHttpApi(device + '_Clima', 'Readings', 'R-reguExtP', function(err, value) {
        if (err) {
            callback(err, null);
        } else {
            callback(null, value);
        }
    });
}

function getState(device, callback) {
    reqHttpApi(device, 'Internals', 'STATE', function(err, value) {
        if (err) {
            callback(err, null);
        } else {
            callback(null, value);
        }
    });
}

function getMode(device, callback) {
    reqHttpApi(device + '_Clima', 'Readings', 'controlMode', function(err, value) {
        if (err) {
            callback(err, null);
        } else {
            callback(null, value);
        }
    });
}

function doesDeviceExist(device, callback) {
    reqHttpApi(device, 'Internals', 'DEF', function(err, value) {
        if (err) {
            callback(null, false);
        } else {
            // console.log('---------------------');
            // console.log('DOES DEVICE EXIST: '+ JSON.stringify(value));
            // console.log('---------------------');
            if (value) {
                callback(null, value);
            } else {
                callback(null, false);
            }
        }
    });
}


function getPeeredSensor(device, callback) {
    reqHttpApi(device, 'Internals', 'peerList', function(err, value) {

        if (err) {
            callback(err, null);
        } else {
            // look for a valid peerID
            if (value) {
                if (value.indexOf('extTemp') > -1) {
                    if (value.slice(-1) === ',') {
                        value = value.slice(0, -1);
                    }
                    callback(null, value);
                } else if (value.match(/[1-9]+/) !== null) {
                    callback(null, value.match(/[1-9]+/)[0]);
                } else {
                    callback(null, false);
                }

            } else {
                callback(null, false);

            }

        }
    });
}

module.exports.write = write;
module.exports.listen = listen;
module.exports.pairing = pairing;
module.exports.getSerialNo = getSerialNo;
module.exports.getPairedTo = getPairedTo;
module.exports.getCommandAccepted = getCommandAccepted;
module.exports.getBurstRx = getBurstRx;
module.exports.getBtnLock = getBtnLock; 
module.exports.getState = getState;
module.exports.getActivity = getActivity;
module.exports.getMode = getMode;
module.exports.setTarget = setTarget;
//module.exports.initHMDevice = initHMDevice;
module.exports.getWindowOpnMode = getWindowOpnMode;
module.exports.getWindowOpnTemp = getWindowOpnTemp;
module.exports.getWindowOpnPeriod = getWindowOpnPeriod;
module.exports.getTempOffset = getTempOffset;
module.exports.getRegAdaptive = getRegAdaptive;
module.exports.setRegAdaptive = setRegAdaptive;
module.exports.getRegExtP = getRegExtP;
module.exports.getRegExtI = getRegExtI;
module.exports.setRegExtP = setRegExtP;
module.exports.setRegExtI = setRegExtI;
module.exports.doesDeviceExist = doesDeviceExist;
module.exports.getPeeredSensor = getPeeredSensor;
module.exports.getHmId = getHmId;
module.exports.setHmId = setHmId;