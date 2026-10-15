// Test-only bridge: run the same regression suite against a disposable local PG server.
const {Client}=require(process.env.STORE_PG_MODULE || 'pg');
const url=new URL(process.env.STORE_TEST_DATABASE_URL);
if(!['127.0.0.1','localhost'].includes(url.hostname)||url.pathname!=='/closeout_test')throw Error('Disposable localhost closeout_test database required');
class PGlite {
 constructor(){this.client=new Client({connectionString:url.href});this.ready=this.client.connect();}
 async query(sql,args){await this.ready;return this.client.query(sql,args);}
 async exec(sql){return this.query(sql);}
 async newConnection(){const c=new Client({connectionString:url.href});await c.connect();await c.query('set statement_timeout=10000');return c;}
 async close(){await this.client.end();}
}
module.exports={PGlite};
