

'use strict'

var net = require('net');
var request = require('request');


var config = require('../config.json');
var HOST = config.HOST;
var HTTPPORT = config.HTTPPORT;
var NETPORT = config.NETPORT;

var client = new net.Socket();

var fbHomeRefBuffer = null;

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

    console.log('Start listening to fhem...');
        
    // Subscribe to all fhem events 
    write('inform timer\n');

    client.on('data', function(data) {
        console.log('yeah, data coming!');
        // Parse fhem data
        data = data.toString();
        var lines = data.split('\n');
        lines = lines.map(function (line) { return line.split(' ') });
        for (var i=0;i<lines.length;i++) {
            var line = lines[i];
            if (line.length > 5) {
                var fhemDeviceName = line[3];
                var fhemAttribute = line[4];
                var re = new RegExp(/([A-Z,0-9])\b/);

                // fhemDevice is thermostat
                if (fhemDeviceName.indexOf('HM_CC_RT_DN') > -1) {
                    if (re.test(fhemDeviceName)) {
                        var thermostatId = fhemDeviceName;
                        var thermostatRef = fbThermostatRef.child(thermostatId);
                        thermostatRef.child('fhem_name').set(fhemDeviceName);
                        thermostatRef.child('lastSeen').set(new Date().toString());
                        if ( fhemAttribute[fhemAttribute.length-1] == ':' && fhemAttribute != 'T:') {
                            fhemAttribute = fhemAttribute.slice(0,fhemAttribute.length-1);
                            var fhemAttributeValue = line[5];
                            thermostatRef.child('fhem_'+fhemAttribute).set(fhemAttributeValue);
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
    console.log(err);
    listen();
});

function initHMDevice(fbGateWayref) {
    if (fbGateWayref.child('hmDevice')) {
        hmDevice = fbGateWayref.child('hmDevice');
    }
    else {
        reqHttpApi('CUL','Name',null,function(err,value) {
            if (!err && value) {
             hmDevice = value;
             fbGateWayref.child('hmDevice').set(value);   
            }
        });
    }
}

function pairing(period) {
    write('set '+hmDevice+' hmPairForSec '+period+'\n');
}

function setTarget(device,target) {
    write('set '+device+'_Clima controlManu '+target+'\n');
}  

function reqHttpApi(device,propertyLoc,property,callback) {
    request('http://'+HOST+':'+HTTPPORT+'/fhem?cmd=jsonlist2%20'+device+'&XHR=1', function (error, response, body) {
        if (!error && response.statusCode == 200) {
            var jsonObj = JSON.parse(body);
            var value = (jsonObj.Results[0])[propertyLoc][property];
            callback(null,value);
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
module.exports.initHMDevice = initHMDevice;