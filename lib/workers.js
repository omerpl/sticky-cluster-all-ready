'use strict';
var cluster = require('cluster');
var log = require('./log');

module.exports = function (options) {
  var DEBUG = options.debug;
  var CONCURRENCY = options.concurrency;
  var PREFIX = options.prefix;
  var ENV = options.env;
  var ids = [];
  var running;

  function create(index, callback) {
    // create
    var env = ENV(index);
    var worker = cluster.fork(env);
    ids[index] = worker.id;

    // revive dead
    worker.on('exit', function (code, signal) {
      if (DEBUG) log('WORKER #%d  ..stopped', worker.id);
      if (running) create(index);
    });

    worker.on('message', (workerId) => {
      console.debug('WORKER WITH ID : ' + workerId + ' is READY TO ACCEPT REQUESTS');
      if (workerId == CONCURRENCY) {
        // if workerId is equal to CONCURRENCY it means that all(or at least one) workers is up. we can make master to listen  
        callback();
      }
    });

    // log
    if (DEBUG) log('WORKER #%d  ..started', worker.id);
  }

  async function serve(server) {
    var worker = cluster.worker;
    var id = worker.id;

    // listen for master's commands
    process.on('message', function (message, connection) {
      // ignore every message except master's
      if (message === PREFIX + 'connection') {
        // log
        if (DEBUG) log('WORKER #%d  got conn from %s', id, connection.remoteAddress);

        // emulate a connection event on the server by emitting the
        // event with the connection master sent to us
        server.emit('connection', connection);

        // resume as we already catched the conn
        connection.resume();
      }
    });

    // start local server
    await server.listen(
      0 /* start on random port */,
      'localhost' /* accept conn from this host only */
    );
    process.send(id);
  }

  function entrust(index, connection) {
    var id = ids[index];
    if (DEBUG) log('MASTER  conn from %s goes to worker #%d', connection.remoteAddress, id);
    cluster.workers[id].send(PREFIX + 'connection', connection);
  }

  function kill(index) {
    var id = ids[index];
    if (DEBUG) log('WORKER #%d  stop..', id);
    cluster.workers[id].process.kill(/* if no argument is given, 'SIGTERM' is sent */);
  }

  function createAll(callback) {
    var i = CONCURRENCY;
    while (--i >= 0) create(i, callback);
  }

  function killAll() {
    var i = CONCURRENCY;
    while (--i >= 0) kill(i);
  }

  function start(callback) {
    running = true;
    createAll(callback);
  }

  function stop() {
    if (running) {
      running = false;
      killAll();
    }
  }

  return {
    start: start,
    serve: serve,
    entrust: entrust,
    stop: stop
  };
};
