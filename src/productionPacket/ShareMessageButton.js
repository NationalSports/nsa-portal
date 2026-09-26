import React, {useState} from 'react';
import {packetRequest} from './api';
export default function ShareMessageButton({soId,messageId,notify}) {
 const [busy,setBusy]=useState(false), [shared,setShared]=useState(false);
 return <button disabled={busy||shared} title="Share this message and its attachments with production packet recipients. Other SO messages remain internal." onClick={async e=>{e.stopPropagation();setBusy(true);try{await packetRequest({action:'share_message',so_id:soId,message_id:messageId});setShared(true);notify?.('Message and attachments shared with production packet recipients');}catch(err){notify?.(err.message,'error');}finally{setBusy(false);}}}>{shared?'Shared with decorator':busy?'Sharing…':'Share with decorator'}</button>;
}
