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
  streams: [
    {
            stream: process.stdout,
            level: 'info'
        },
    {
      level: 'info',
      stream: bunyanLogentries.createStream({token: '2f63e221-e11a-44e3-b5f3-3bd09a39bdc2'}),
      type: 'raw'
    }]
 });

var hmDevice = 'hmusb';
function write(msg) {
    if (client.writable) {
        client.write(msg);
    }
    else {
        client.connect(NETPORT, HOST, function() {
            client.write(msg);
        });
    }    
}

function listen(fbHomeRef) {
    if (typeof fbHomeRef !== 'undefined') {
        fbHomeRefBuffer = fbHomeRef;
    }
    else {
        fbHomeRef = fbHomeRefBuffer;
    } 
    var fbThermostatRef = fbHomeRef.child('thermostats');

    log.info({host: hostname}, 'Start listening to fhem...');
        
    // Subscribe to all fhem events 
    write('inform timer\n');

    client.on('data', function(data) {
        //log.info('yeah, data coming!');
        // Parse fhem data
        data = data.toString();
        var lines = data.split('\n');
        lines = lines.map(function (line) { return line.split(' '); });
        for (var i=0;i<lines.length;i++) {
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
                        if ( fhemAttribute[fhemAttribute.length-1] === ':' && fhemAttribute !== 'T:') {
                            fhemAttribute = fhemAttribute.slice(0,fhemAttribute.length-1);
                            var fhemAttributeValue = line[5];
                            if (fhemAttribute === 'desired-temp') {
                                if ( fhemAttributeValue === 'off' ) {
                                    fhemAttributeValue = 5;
                                }
                                else if (fhemAttributeValue === 'on') {
                                    fhemAttributeValue = 30;
                                }
                            }
                            thermostatRef.child('fhem_'+fhemAttribute).set(fhemAttributeValue);
                        }
                        else if ( fhemAttribute.toUpperCase().trim() === 'NACK') {
                            log.warn({host: hostname, thermostat: thermostatId}, 'Got NACK from thermostat');
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
    log.warn({host: hostname}, ' FHEM-Error: '+ err);
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
    write('set '+hmDevice+' hmPairForSec '+period+'\n');
}

function setTarget(device,target) {
    write('set '+device+'_Clima controlManu '+target+'\n');
    write('set '+device+' burstXmit\n');
}  

function reqHttpApi(device,propertyLoc,property,callback) {
    request('http://'+HOST+':'+HTTPPORT+'/fhem?cmd=jsonlist2%20'+device+'&XHR=1', function (error, response, body) {
        if (!error && response.statusCode === 200) {
            try {
                var jsonObj = JSON.parse(body);
                var value = (jsonObj.Results[0])[propertyLoc][property];
                callback(null,value);
            }
            catch(e) {
                callback(e,null);
            }    
        }
        else {
            callback(error,null);
        }
    });
}

function getSerialNo(device,callback) {
    reqHttpApi(device,'Attributes','serialNr',function(err,value) {
        if (err) {
            callback(err,null);
        }
        else {
            callback(null,value);
        }    
    });
}

function getPairedTo(device,callback) {
    reqHttpApi(device,'Readings','PairedTo',function(err,value) {
        if (err) {
            callback(err,null);
        }
        else {
            callback(null,value);        
        }
    });
}

function getActivity(device,callback) {
    reqHttpApi(device,'Readings','Activity',function(err,value) {
        if (err) {
            callback(err,null);
        }
        else {
            callback(null,value);        
        }
    });
}

function getCommandAccepted(device,callback) {
    reqHttpApi(device,'Readings','CommandAccepted',function(err,value) {
        if (err) {
            callback(err,null);
        }
        else {
            callback(null,value);        
        }
    });
} 

function getBtnLock(device,callback) {
    reqHttpApi(device,'Readings','R-btnLock',function(err,value) {
        if (err) {
            callback(err,null);
        }
        else {
            callback(null,value);        
        }
    });
}

function getBurstRx(device,callback) {
    reqHttpApi(device,'Readings','R-burstRx',function(err,value) {
        if (err) {
            callback(err,null);
        }
        else {
            callback(null,value);        
        }
    });
}

function getWindowOpnMode(device,callback) {
    reqHttpApi(device+'_Clima','Readings','R-winOpnMode',function(err,value) {
        if (err) {
            callback(err,null);
        }
        else {
            callback(null,value);        
        }
    });
}


function getTempOffset(device,callback) {
    reqHttpApi(device+'_Clima','Readings','R-tempOffset',function(err,value) {
        if (err) {
            callback(err,null);
        }
        else {
            callback(null,value);        
        }
    });
}

function getRegAdaptive(device,callback) {
    reqHttpApi(device+'_Clima','Readings','R-regAdaptive',function(err,value) {
        if (err) {
            callback(err,null);
        }
        else {
            callback(null,value);        
        }
    });
}

function getState(device,callback) {
    reqHttpApi(device,'Internals','STATE',function(err,value) {
        if (err) {
            callback(err,null);
        }
        else {
            callback(null,value);        
        }
    });
}

function getMode(device,callback) {
    reqHttpApi(device+'_Clima','Readings','controlMode',function(err,value) {
        if (err) {
            callback(err,null);
        }
        else {
            callback(null,value);        
        }
    });
}

function doesDeviceExist(device,callback) {
     request('http://'+HOST+':'+HTTPPORT+'/fhem?cmd=jsonlist2%20'+device+'&XHR=1', function (error, response, body) {
        if (!error && response.statusCode === 200) {
            try {
                var jsonObj = JSON.parse(body);
 
                // Check if array is empty which means device does not exist
                if ( (jsonObj.Results).length < 1 ) {

                    callback(null,false);
                }
                else {
                    callback(null,true);
                }
            }
            catch(e) {
                callback(e,null);
            }    
        }
        else {
            callback(error,null);
        }
    });
}      

function isPeered(device,callback) {
    reqHttpApi(device,'Attributes','peerIDs',function(err,value) {
        if (err) {
            callback(err,null);
        }
        else {
            // look for a valid peerID
            if (value.match(/[1-9]/)) {
                callback(null,true);        
            }
            else {
                callback(null,false);
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
module.exports.getTempOffset = getTempOffset;
module.exports.getRegAdaptive = getRegAdaptive;
module.exports.doesDeviceExist = doesDeviceExist;
module.exports.isPeered = isPeered;