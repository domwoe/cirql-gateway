/*jslint node: true */
'use strict';

var forever = require('forever'),
    child = new(forever.Monitor)('app.js', {
        'silent': false,
        'pidFile': 'pids/cirql-gateway.pid',
        'watch': true,
        'watchDirectory': '.',      // Top-level directory to watch from.
        'watchIgnoreDotFiles': true, // whether to ignore dot files
        'watchIgnorePatterns': [],
        'spinSleepTime': 5000,       // array of glob patterns to ignore, merged with contents of watchDirectory + '/.foreverignore' file
        'logFile': '../forever.log', // Path to log output from forever process (when daemonized)
        'outFile': '../forever.out', // Path to log output from child stdout
        'errFile': '../forever.err'
    });
child.start();
forever.startServer(child);