/***************************************\
          IRC#nodester client
\***************************************/
 
/*
 * @name       : irc.js
 * @mainteiner : Alejandro Morales <vamg008@gmail.com>
 * @licence    : GNU Affero
 * @updated    : 17-03-2012
 * @repo       : http://github.com/nodester/irc
 * @version    : 2.0.0
 * 
 * @note       : Currently there is no implementation for IRC commands.
 *             : This choice is by design. 
*/

var http    = require('http')
  , fs      = require('fs')
  , io      = require('socket.io')
  , express = require('express')
  , ircjs   = require('irc-js')
  , cfg     = { channel:'#nodester' }
  , app     = express.createServer()
  , io      = require('socket.io').listen(app);


//when the app started
var starttime = (new Date()).getTime();
//get usage RAM in bytes
var currMem = process.memoryUsage().rss;
var minMem = currMem;
var maxMem = currMem;
var webUsers = [];
var bWebUsersDirty = false; //flag to indicate if the webUsers changed

//every 15 seconds poll for the memory
var tmr = setInterval(function () {
    currMem = process.memoryUsage().rss;
    if (currMem < minMem) {
        minMem = currMem;
        return
    };
    if (currMem > maxMem) {
        maxMem = currMem;
    };
}, 15*1000);

process.on('uncaughtException', function (err) {
  console.log('Uncaught error: ' + err.stack);
});

var allowCORS = function(req,res,next){
  res.header("Access-Control-Allow-Origin", "*");
  res.header("Access-Control-Allow-Headers", "X-Requested-With");
  res.header("Strict-Transport-Security", "max-age=31556926; includeSubDomains");
  res.header("X-Powered-By","nodeJS");
  next();
};

app.configure(function(){
  app.use(express.static(__dirname + '/public'));
  app.use(allowCORS);
});

app.get('/', function(req, res, next){
  res.render('./public/index.html');
});

app.listen(process.env.C9_PORT || process.env['app_port'] || 80);

console.log('IRC#nodester is running on %d',app.address().port)

/*
 * Sockets stuff
*/
io.set('log level', 1); //reduce debug messages
io.sockets.on('connection', function (client) {
  var socket = client;
  var irc = null;
  var nickname = null;
  client.on('message', function(data) {
    var obj = JSON.parse(data);
    if (obj.hasOwnProperty('nickname')) {
      if (irc === null) {
        nickname = obj.nickname;
        irc = new ircjs({
          server: 'irc.freenode.net',
          port: 6667,
          nick: nickname,
          user: {
            username: nickname,
            hostname: 'irc.nodester.com',
            servername: 'irc.freenode.net',
            realname: nickname + ' via http://irc.nodester.com/'
          }
        });
        
        console.log(irc)
        irc.connect(function () {
          irc.join(cfg.channel);
        });
        
        irc.addListener('privmsg', function (message) {
          if (message.params[0] == cfg.channel) {
            client.send(JSON.stringify({
              messagetype: "message",
              from: message.person.nick,
              channel: (message.params[0]),
              message: (message.params[1])
            }));
          } else {
            irc.privmsg(message.person.nick, "I can only talk in #nodester.");
          }
        });
        
        irc.addListener('join', function (message) {
          client.send(JSON.stringify({
            messagetype: "join",
            from: (message.person.nick),
            channel: (message.params[0])
          }));
        });
        
        //topic 332
        irc.addListener('332', function (raw) {
          client.send(JSON.stringify({
            messagetype: "topic",
            //nick
            from: (raw.params[0]),
            //channel
            channel: (raw.params[1]),
            //topic
            message: (raw.params[2])
          }));
        });
        
        //names list incoming 353
        irc.addListener('353', function (raw) {
          client.send(JSON.stringify({
            messagetype: "names",
            //nick
            from: (raw.params[0]),
            //channel
            channel: (raw.params[2]),
            message: "",
            //users as a space delimited string
            users: (raw.params[3].split(" "))
          }));
        });
        
        //end of names list 366
        irc.addListener('366', function (raw) {
          client.send(JSON.stringify({
            messagetype: "endnames",
            //nick
            from: (raw.params[0]),
            //channel
            channel: (raw.params[1]),
          }));
        });

        //on disconnect from irc server
        irc.addListener('quit', function (message) {
          client.send(JSON.stringify({
            messagetype: "quit",
            from: (message.person.nick),
            channel: (message.params[0])
          }));
        });

        //on nickname already in use, 433
        irc.addListener('433', function (message) {
          client.send(JSON.stringify({
            messagetype: "433",
            //rejected nick
            from: (message.params[1]),
            //the irc server as channel
            channel: message.server,
            //the rejection message, usually "Nickname is already in use."
            message: (message.params[2])
          }));
        });

        //on parting the channel but remaining connected to the irc server
        irc.addListener('part', function (message) {
          client.send(JSON.stringify({
            messagetype: "part",
            from: (message.person.nick),
            channel: (message.params[0])
          }));
        });

        //motd
        irc.addListener('372', function (raw) {
          client.send(JSON.stringify({
            messagetype: "motd",
            //server
            from: (raw.server),
            //channel
            channel: "",
            //topic
            message: (raw.params[1])
          }));
        });

        irc.addListener('376', function (raw) {
          client.send(JSON.stringify({
            messagetype: "endmotd",
            //server
            from: (raw.server)
          }));
        });
        
        //welcome from ircserver
        irc.addListener('001', function (raw) {
          webUsers.push(irc.options.nick);
          bWebUsersDirty = true;
          client.send(JSON.stringify({
            messagetype: "001",
            //server
            from: (raw.server),
            //channel
            channel: "",
            //topic
            message: (raw.params[1])
          }));
        });
        
        irc.addListener('notice', function (message) {
          if (message.person !== undefined) {
            //notice for content
            client.send(JSON.stringify({
              messagetype: "notice-msg",
              from: (message.person.nick),
              channel: "",
              message: (message.params[1])
            }));
          } else {
            //notice at login
            client.send(JSON.stringify({
              messagetype: "notice",
              from: (message.params[0]),
              channel: "",
              message: (message.params[1])
            }));
          }
        });
        
        //all IRC errors but 433 handles above
        for (var err = 400; err < 600; err++) {
          if (err != 433) {
            irc.addListener(err, function (raw) {
              client.send(JSON.stringify({
                messagetype: "notice-err",
                from: "",
                channel: "",
                message: raw.raw
              }));
            }); //addListener
          }; //if
        }; //for

        //all client errors (e.g., timeouts)
        irc.addListener('error', function () {
          client.send(JSON.stringify({ 
            messagetype: "error"
          }));
        });
      } else {
        // Maybe handle updating of nicks one day :)
      }
    } else if (obj.hasOwnProperty('messagetype')) {
      switch (obj.messagetype) {
        case "message":
          irc.privmsg(cfg.channel, (obj.message));
          break;
        default:
          console.log(data);
          break;
      }
    } else if (obj.hasOwnProperty('statistics')) {
        //there is a lag here, at maximum though it is 16 seconds since last update
        client.send(JSON.stringify({
          messagetype: "statistics",
          st: starttime,
          min: minMem,
          max: maxMem,
          current: currMem,
          wud: bWebUsersDirty
        }));
    } else if (obj.hasOwnProperty('webusers')) {
        bWebUsersDirty = false;
        client.send(JSON.stringify({
          messagetype: "webusers",
          wu: webUsers
        }));
    };
  });

  client.on('disconnect', function() {
    if (irc){
      for (var i = 0; i < webUsers.length; i++) {
          if (webUsers[i] == irc.options.nick) {
              webUsers.splice(i, 1);
              bWebUsersDirty = true;
              break;
          }
      }
      irc.quit();
      irc = null;
    }
  });

});