
var QUEUE_TYPE = {
    Sync    :'Sync',
    Parallel:'Parallel',
    Relevant:'Relevant'
}

function LineQueue( queueType ){
    var Queue = [];
    /*
    * @desc 默认是一个并行的队列。
    */
    var queueType = queueType || QUEUE_TYPE.Parallel;

    /*
    * @desc 设置队列是一个严格串行的队列。
    */
    this.setSync = function(){
        queueType = QUEUE_TYPE.Sync;
    }

    /*
    * @desc 设置队列是一个 串行调用的队列，如果是 fn是异步，那就完全并发的
    */
    this.setParallel = function(){
        queueType = QUEUE_TYPE.Parallel;
    }

    /*
    * @desc 设置队列是一个 相关联的队列。比如队列中的任何一个 同步 or 异步操作完成。其它任何操作都直接使用其结果。
    */
    this.setRelevant = function(){
        queueType = QUEUE_TYPE.Relevant;
    };

    /**
     * 用于在回调设置了true 后，在 Relevant 和 Sync情况下对队列的操作
     * 例子中的setTimeout就是回调函数。结束后，调用this.done()将end设置为true。
     * 只被 _runSync调用。
     */
    var _processQueueAfterSetEnd = function(){
        var nextQueueItem = null; 
                        
        if ( queueType === QUEUE_TYPE.Relevant ){
            while( nextQueueItem = Queue.shift()){
                if( 'function' == typeof nextQueueItem.backFn){
                        nextQueueItem.backFn.call(
                        nextQueueItem.context,
                        Queue.injectData
                    );
                }                
            }
        }
        if( queueType === QUEUE_TYPE.Sync ){
            while( nextQueueItem = Queue.shift()){
                if( !nextQueueItem.called ){
                    break;
                }
            }
            if( nextQueueItem && nextQueueItem.fn){
                try{
                    if( Queue.injectData ){
                        nextQueueItem.fn.call(
                            nextQueueItem.context,
                            Queue.injectData
                        );
                    }
                    else{
                        nextQueueItem.fn.call(nextQueueItem.context);
                    }
                }catch(e){
                    nextQueueItem.context.end = true;
                }                            
            }
        }     
    };
    /**
     * 运行严格的串行队列。
     * 
     * @param {any} fn 
     */
    var _runSync = function(fn){

        /*
        * @desc 做一些基本的校验。
        */
        if( queueType === QUEUE_TYPE.Relevant ){
            if( 'function' != typeof fn.fn ){
                throw "Illegal param, parm.fn should be function ";
            }
            if( 'function' != typeof fn.backFn ){
                throw "Illegal param, fn.backFn should be function ";
            }
        }else if( queueType === QUEUE_TYPE.Sync ) {
            if('function' != typeof fn){
                throw "Illegal param,param should be function ";
            }
        }

        /*
        * @desc 创建一下队列函数的作用域，为方便使用者直接使用this.done来解耦。
        */
        var context = Object.create(Object.prototype,{
            end:{
                get : function(){
                    return this.ended;
                },
                set : function(newValue){
                    this.ended = newValue;
                    if( true === newValue ){
                        _processQueueAfterSetEnd();          
                    }
                }
            }            
        });
        /**
         * 用于标识任何回调函数结束。
         * 
         * @param {any} injectData 
         */
        context.done = function(injectData){
            if( injectData ){
                Queue.injectData = injectData;
            }
            this.end = true;
        };

        /*
        * @desc 临时的一个队列项。
        */
        var queueItem = {};

        if( queueType === QUEUE_TYPE.Relevant ){
            queueItem = {
                fn      :fn.fn,
                backFn  :fn.backFn,
                context :context
            };
        }
        if( queueType === QUEUE_TYPE.Sync ){
            queueItem = {
                fn:fn,
                context:context
            };
        }
        Queue.push(queueItem);

        /*
        * @desc 这里是上帝之手，真正触发第一个元素call起来。然后它会引发后续的元素继续call起来。
        */
        if( 'function' != typeof queueItem.fn ){
            throw "Illegal param,param should be function ";
        }
        if( queueType === QUEUE_TYPE.Relevant ){
            if( !!Queue.injectData ){
                _processQueueAfterSetEnd();
            }else{
                if( 1 === Queue.length ){
                    queueItem.fn.call(queueItem.context);
                    queueItem.called = true;
                }                
            }            
        }
        if( queueType === QUEUE_TYPE.Sync ){
            if( 1 === Queue.length ){
                queueItem.fn.call(queueItem.context);
                queueItem.called = true;
            }            
        }
    };
    /**
     * 运行并发的函数。不管此函数是同步，还是异步。直接调用就好。
     * 
     * @param {any} fn 
     */
    var _runParallel = function(fn){
        var context   = {};
        var queueItem = {
            fn:fn,
            context:context
        };
        fn.call(queueItem.context);
    };
    /**
     * 关注这个 fn 会是异步或者同步函数。
     * 
     * @param {any} fn 
     */
    this.run = function(fn){
        switch( queueType ){
            case QUEUE_TYPE.Sync:
            case QUEUE_TYPE.Relevant:
                _runSync(fn);
                break;
            case QUEUE_TYPE.Parallel:
                _runParallel(fn);
                break;
        }
    };
}

module.exports = LineQueue;
/*
* @desc tester
*/

/**
 * usage:
 * 1、完全串行的队列。
 * 
 * 
 * 走一遍运行过程，刚开始第一个执行任务，即fnA进入运行队列，因为队列长度为1（165行），所以该函数，即该任务操作可以运行，遇到setTimeout进入eventtable，之后运行221行，下一个队列任务，即fnB入队，当走到165行后，因为上一个队列中有异步操作导致上一个任务没运行完，所以队列长度为2，不满足==1的条件，所以不会执行该任务。等到fnA异步操作执行完后，执行this.done()，该函数中将end设为true,然后就回去执行_processQueueAfterSetEnd()函数，处理下一个队列项的任务。就这样反复从队列中取任务，如果没有异步，直接执行、出队、下一个执行，如果有异步，则后面的等前面的，异步执行完毕后通过this.done()启动队列中下一个任务的执行。这样就保证了该队列中的任务完全串行执行。
 * 
 * 
.
 * 
 * 
 * 而且上一个执行的任务可以通过this.done()向下一个任务传递参数...有点promise的作用，解决了回调地狱，不用讲下一个任务放到上一个任务的success中去了。
  var lqueue = new LineQueue();
  lqueue.setSync();
  lqueue.run(functionA(){
       setTimeout(function(){
           console.log('run first');
           this.done(dataToNext) 或者 this.done();   //这句话一定要异步完成后，调用。
       }.bind(this),2000);
  });
  lqueue.run(functionB(data){
       setTimeout(function(){
           console.log('run second');
           console.log(data);
           this.done() //这句话一定要异步完成后，调用。
       }.bind(this),1000);a
  });
 * 
 * 效果：在2s后，打印出run first，出了打印run first后，再过1s,打印出run second 和前一次调用 的dataToNext;
 * 如果直接调用 functionA,functionB,则我们会先打印出 run second,run first。其实这对于我们有依赖的调用 两次cgi的场景，是不合理的。
 * 
 * 2、相关联的队列。
 * 功能：对同一个异步操作，为了开了方便，我们一下子调用了N次，而这N次，只需要有一次返回了结果就可以。其它的N-1次 可以省略。
 * 比如我们的 getUinKey 函数。verifyJsapi。
 * 
 * 
 * 解释一下，这个关联队列的例子就是，会先执行fn,fn执行完毕之后再调用backFn, fn可以通过this.done()向backFn传递参数。
 * 如果底下再来多个同样的任务，即请求了多次，那么只要一个的fn做成了，其它的再运行时就会进入_processQueueAfterSetEnd()函数进行回调。
 * e.g 1
  var lqueue = new LineQueue();
  lqueue.setRelevant();
  lqueue.run({
       fn:function(){
           setTimeout(function(){
               //e.g.这里是一个cgi调用。
               this.done({a:1});
           }.bind(this),2000);
       },
       backFn:function(data){
           console.log(data); //输出 {a:1}
       }
  });
  
 * e.g 2
  var lqueue = new LineQueue();
  lqueue.setRelevant();
  lqueue.run({
       fn:function(){
           wxBridge.getUinKey(function(login){
               this.done(login);
               //有了登陆态，就可以开始请求其它cgi咯。
           }.bind(this));
       },
       backFn:function(data){
           //有了登陆态，就可以开始请求其它cgi咯。
           //这里可以
       }
  });
  
 * 3、并发队列。 
  var lqueue = new LineQueue();
  lqueue.setParallel();
  lqueue.run(functionA(){
     console.log('a');  
  });
  lqueue.run(functionB(){
     console.log('B');  
  });
  
 * 这与  
 * functionA();
 * functionB()
 * 等 价。
 */
