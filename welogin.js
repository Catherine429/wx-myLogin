
var Deeprequest = require('./request');          //网络请求API
var Strings     = require('./string');           //字符串相关方法
var LineQueue   = require('./queue');            //队列（异步，同步）相关方法

/*
* @desc 专门封装的一个对session进行操作的对象
*/
var Session = {
    /*
    * @desc 这是session 存储用的唯一 key
    */
    SESSIONKEY:'__SESSION__KEY__',
    /*
    * @desc 空值。
    */
    empty : 'nil',
    /*
    * @desc 空的session，用于初始化。
    */
    emptySession : {
        sessionId   : 'nil',
        userId      : 'nil',
        lastTime    : 'nil',
        openid      : 'nil'
    },
    /**
     * 写一个session到存储
     * 
     * @param {any} partSession 
     */
    setSession : function(partSession) {
        var srcSession = this.getSession();
        for (var p in partSession) {
            srcSession[p] = partSession[p]
        }
        wx.setStorageSync(this.SESSIONKEY, JSON.stringify(srcSession));
    },
    /**
     * 判断当前session 是不是完全满足要求。缺少一个字段，都认为非法
     * 
     * @returns 
     */
    isSessionFull : function() {
        var srcSession = this.getSession();
        /**这里是用emptySession 来做强制性的模板。 */
        for (var p in Session.emptySession) {
            if (Session.empty   === srcSession[p] 
                || '0'          === srcSession[p] 
                || undefined    === srcSession[p]) 
            {
                return false;
            }
        }
        return true;
    },
    /**
     * 同步读取session
     * 
     * @returns 
     */
    getSession : function() {
        var clearSession = this.emptySession;

        var v = wx.getStorageSync(this.SESSIONKEY);
        var s = clearSession;
        try {
            if (('' + v).length > 0) {
                s = JSON.parse(v + '');
            }
        } catch (e) {
            s = clearSession;
        } finally {
            var now = this.getCurrentTimeStamp();

            //如果最后过期时间小于当前时间，就说明已经过期了。
            if(s.lastTime <= now){
                s = clearSession;
            }
        }
        return s;
    },
    /**
     * 计算当前时间。
     * 
     * @returns 
     */
    getCurrentTimeStamp : function() {
        return parseInt((new Date()).getTime() / 1000);
    }
};

/*
* @desc 请求用的队列。
*/
var pQueue = new LineQueue();
/*
* @desc 设置为相关联队列。
*/
pQueue.setRelevant();
/*
* @desc 请求器。
*/
var Requester = {
    /**
     * 只是添加session_id到url里
     * 
     * @param {any} url 
     * @returns 
     */
    addLoginToRequest:function(url){
        /*
         *  强制在url后面加上session_id
         */
        url = url || '';
        /*
        * @desc 先去掉url中的hash
        */
        var _str = ('' + url).replace(/#(.*)$/g, '').replace(/&amp;/g, '&');

        var prefix = url,queryMap = {};

        /*
        * @desc 如果原来就有query，先找到它。取出来。放入queryMap
        */
        var isQueryStart = _str.indexOf('?');
        if (-1 != isQueryStart) {
            prefix = _str.substr(0, isQueryStart);
            var query = _str.substr(isQueryStart + 1);
            queryMap = Strings.strToMap(query);
        }
        /*
        * @desc 取到session
        */
        var tSession = Session.getSession();
        /*
        * @desc 添加到原来的queryMap里。
        */
        queryMap.session_id = encodeURIComponent(tSession.sessionId);
        /*
        * @desc 这句话，后台已做判断，不再要求传了。于是这个新版干掉了。
        */
        // queryMap.auth_type  = 8;
        /*
        * @desc 重新拼接上url,此时url中已有了session_id 的queryString
        */
        url = prefix + '?' + Strings.mapToStr(queryMap);
        return url;
    },

    //登录是否过期
    isLoginExpire : function(cgiData){
        var res = cgiData;
        if( '' + res.errcode === '-1702220400' || 
            '' + res.errcode === '-1702220407' || 
            res.ret          === 6211          ||                
            res.logicret     === 6204 ){

              //过期了就重置
            Session.setSession(Session.emptySession);
            return true;
        }
        return false;
    },
    /**
     * 发起一个请求。格式 
     * {
     *       url: FETCH_URL + 'readygame',
     *       data: req,
     *       method: "POST",
     *       header: {
     *           'content-type': 'application/json'
     *       },
     *       success: function(data) {
     *          console.log('requestReadyGame', data)
     *              resolve(data);
     *       },
     *       fail: function(data) {
     *          resolve(data);
     *       },
     *       complete : function(res){
     *           resolve(res);
     *       }
     *   }
     * @param {any} data 
     */


    //該函數對請求進行包裝
    request: function(req){
        var _Requester = this;
        var tryLoginTimes = 2,
            tryLoginCounter = 0;

        // 除了登录请求，其他请求一率等待，只允许有一个登录
        if(Loginer.isLogining){
            setTimeout(function(){
                Requester.request.call(_Requester, req);
            }, 30);
            return;
        }
        var preFn = function(){
            var that = this;
            if( !Session.isSessionFull() ){

              //如果session不完整的話，就重新登陸一次
                Loginer.login(function(){
                    that.done();
                });
            } else{
                that.done();
            }
        };
        var backFn = function(){
            var _c = this;
            var url = Requester.addLoginToRequest(req.url);
            var tag = Session.getCurrentTimeStamp() +  ' call cgi: ' + url;
            console.log(tag + ' start');
            Deeprequest({
                url: url,
                data: req.data,
                method: req.method,
                header: {
                    'content-type': req.header ? req.header['content-type'] : 'application/json'
                },
                success:function(res){
                    res = res.data;

                    var isLoginExpire = Requester.isLoginExpire(res);

                    if( true === isLoginExpire ){
                        var packQueue = new LineQueue();
                        packQueue.setSync();
                        packQueue.run(function(){
                            var that = this;
                            //重新做一次登陆 。
                            Loginer.login(function(){
                                /**
                                 * 如果尝试登陆资料小于3次，就继续尝试。
                                 */
                                if( tryLoginCounter < tryLoginTimes ){
                                    tryLoginCounter++;
                                    that.done();
                                }else{
                                    /**
                                     * 否则直接抛fail
                                     */
                                    req.fail && req.fail.call(_Requester, {
                                        errmsg:'login fail after trying  many times'
                                    });
                                }
                            });
                        });

                        //重新登陸一次后，再重新做一次請求
                        packQueue.run(function(){
                            backFn.call(_c);
                        });
                    }else{
                        req.success && req.success.call(_Requester, res);
                    }
                    console.log(tag + ' success ', res);
                },
                fail:function(res) {
                    req.fail && req.fail.call(_Requester, res);
                    console.log(tag + ' fail ',res);
                },
                complete:function(res) {
                    req.complete && req.complete.call(_Requester, res);
					console.log(tag + ' complete ', res);
                }
            });
        };
        pQueue.run({
            fn      : preFn,
            backFn  : backFn
       });
    }
};


//登录对象
var Loginer = {
    /**
     * 使用队列的登陆功能。
     * 
     * @param {any} callback 它的参数是得到的session 
     */
    login:function( callback ){
        /**
         * 首次清空一下当前登陆值。
         */
        Loginer.isLogining = true;
        Session.setSession(
            Session.emptySession
        );

        var queue = new LineQueue();
        queue.setSync();
        /*
        * @desc 调用wx.login
        */
        queue.run(function(){
            var that = this;
            wx.login({
                success: function(res) {
                    that.done(res);
                },
                fail: function(res) {
                    /*
                    * @desc 清空session对象。供请求时重试。
                    */
                    Session.setSession(
                        Session.emptySession
                    );
                    that.done(res);
                }
            });
        });
        /*
        * @desc 用上一步的code，去换session_id
        */
        queue.run(function(res){
            var that = this;
            var code = res.code;
            var url = 'https://game.weixin.qq.com/cgi-bin/gameweappwap/login';
            var url = 'https://game.weixin.qq.com/cgi-bin/gameweappauthwap/login';
            Deeprequest({
                url: url,
                data: JSON.stringify({
                    code: code,
                    weapp_type: Config.weapp_type || 1,
                    need_openid: true
                }),
                method: "POST",
                header: {
                    'content-type': 'application/json'
                },
                success: function(res){
                    res = res.data;
                    that.done(res);
                },
                fail: function(res){
                    /*
                    * @desc 清空session对象。供请求时重试。
                    */
                    Session.setSession(
                        Session.emptySession
                    );
                    that.done(res);
                }
            })
        });
        /*
        * @desc 把上一步里的session写入本地，完成。
        */
        queue.run(function(session){
            var that = this;
            if( session.data && session.data.session_id ){

                var now = Session.getCurrentTimeStamp();
                var gotSession = {
                    sessionId   : session.data.session_id,
                    userId      : session.data.user_id,
                    lastTime    : now + 3600
                };
                if(session.data.expire_seconds){
                    gotSession.lastTime = now + session.data.expire_seconds;
                }

                /**
                 * 如果后台给了openid
                 * 存起来方便后续使用
                 */
                if ( session.data.openid ){
                    gotSession.openid = session.data.openid;
                }

                Session.setSession(gotSession);
                that.done( gotSession );
            }
            else{
                that.done( null );
            }
        });

        /*
        * @desc 不管前面 三个run结果怎么样，都记得回调，
        * 被done触发。
        */
        queue.run(function(session){
            Loginer.isLogining = false;
            /*
            * @desc 最后执行一下回调
            */
            if(typeof(callback)=='function'){
                callback(session);
            }
        });
    }
};
/*
* @desc 这个config当临时的变量用。
*/
var Config = {};
var baseContext = null;
module.exports = {
    /**
     * 用于注入方法 到app对象里。
     * 
     * @param {any} context 
     */
    prepare: function(context, config) {
        console.log('runed?');
        if( context.prepared){
            return;
        }
        config = config || {};
        
        Config.expiredLoginCodeMap = config.expiredLoginCodeMap;
        Config.weapp_type          = config.weapp_type;

        baseContext     = context;

        Loginer.login.call(context, function(res){
            Loginer.isLogining = false;
            console.warn(407, res)
        });
        
        context.login = Loginer.login.bind(Loginer);
        context.session = Session.getSession.bind(Session);
        context.request = Requester.request;
        context.config  = config;
        context.prepared = true;
    }
};
