var app         = require('express')(),
    database    = require('./config/database'),
    server      = require('http').Server(app),
    io          = require('socket.io')(server),
    redis       = require('redis'),
    config      = require('./config/config'),
    mysql       = require('mysql'),
    socketRedis = require('socket.io-redis');

var redisClient = redis.createClient(database.redis.ipi);
var mysqlCon = mysql.createConnection(database.mysql.ipi);
var redisChannels = ['login', 'broadcast'];
var loggedUsers = {};

server.listen(config.port);

redisClient.subscribe(redisChannels);

mysqlCon.connect(function(err) {
  if (err) throw err;
  console.log('Mysql Connected!');
});

redisClient.on("error", function (err) {
  console.log("Error " + err);
});

// client.get('PHPREDIS_SESSION:h7l8jt2sgg9vliefmd7ndp9b2v', function(err, reply) {
//      console.log(reply);
// });

io.adapter(socketRedis(database.redis.ipi));

io.on('connection', function (socket) {
  var address = socket.handshake.address;

  console.log("new client connected from " + address + " id: " + socket.id + " cookie: " + socket.handshake.headers.cookie);

  socket.on('disconnect', function(data) {
    onClientDisconnect(socket.user_id, socket.id);
    console.log("client from " + address + " id: " + socket.id + " has disconnected");
  });

});

redisClient.on('message', function(channel, message) {
  console.log("new message in channel " + channel);
  console.info(message);
  parsedMessage = JSON.parse(message);
  if(typeof parsedMessage.user_id === 'number'){
    if(channel === 'login'){
      var sessionInfo = parsedMessage;
      var userInfo = {
        sessionId: sessionInfo.sessionId,
        clientId: sessionInfo.clientId,
      }
      if(typeof io.sockets.connected[sessionInfo.clientId] !== 'undefined'){
        io.sockets.connected[sessionInfo.clientId].user_id = sessionInfo.user_id;
        if(!(sessionInfo.user_id in loggedUsers)){
          loggedUsers[sessionInfo.user_id] = [];
        }
        if(!isPropertySet(userInfo, loggedUsers[sessionInfo.user_id], 'clientId')){
          loggedUsers[sessionInfo.user_id].push(userInfo);
        }
      }
      mysqlCon.query('CALL central_systemTA.set_as_online(?)', sessionInfo.user_id, (err, result) => {
        if (err) throw err;
        console.log(sessionInfo.user_id + ' is online!');
      });
    } else {
      var broadcastData = parsedMessage;
      if(loggedUsers.hasOwnProperty(broadcastData.user_id)){
        loggedUsers[broadcastData.user_id].forEach(function(user){
          console.log('emmiting to: ' + user.clientId);
          io.to(user.clientId).emit(broadcastData.channel, broadcastData.data);
        })
      }
    }
  }
});

function onClientDisconnect(userId, disconnectingClientId) {
  if(loggedUsers.hasOwnProperty(userId)){
    loggedUsers[userId] = loggedUsers[userId].filter(function(user){
      return user.clientId !== disconnectingClientId;
    });

    if(loggedUsers[userId].length === 0){
      var disconnectArray = {
        status: 0,
        user_changed_status: userId
      }
      mysqlCon.query('CALL central_systemTA.update_last_seen(?)', userId, (err, result) => {
        if (err) throw err;
        io.emit('client_status', disconnectArray);
        console.log(userId + ' Last seen registered');
      });
    }
  }
}

function isPropertySet(needle, haystack, key){
  var isSet = false
  haystack.forEach(function(el){
    if(el[key] == needle[key]){
      isSet = true;
    }
  });
  return isSet;
}

// setInterval(function () {
//     console.log('Number of loggued users: %d', Object.keys(loggedUsers).length);
//     console.info(loggedUsers);
// }, 30000);

setInterval(function () {
    io.of('/').adapter.clients((err, clients) => {
      console.log(clients); // an array containing all connected socket ids
    });
}, 30000);
