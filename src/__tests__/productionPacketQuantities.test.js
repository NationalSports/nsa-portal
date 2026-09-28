import {quantityEntries} from '../productionPacket/quantities';
import {packetPrintHtml} from '../productionPacket/print';
import {buildProductionPacket} from '../productionPacket/model';
test('quantity boxes sort apparel sizes and keep supplied labels and quantities',()=>{
 expect(quantityEntries({L:3,'2XL':1,S:2,M:4,XL:1,XS:0})).toEqual([['S',2],['M',4],['L',3],['XL',1],['2XL',1]]);
 expect(quantityEntries({'10':2,'8':1,OSFA:3})).toEqual([['OSFA',3],['8',1],['10',2]]);
});
test('download source carries its own scoped stylesheet when cloned out of the iframe',()=>{
 const packet=buildProductionPacket({store:{id:'s',name:'Test'},salesOrders:[],orders:[],lines:[],notes:[]});
 const html=packetPrintHtml(packet);
 expect(html).toContain('<main class="packet-document"><style>');
 expect(html).toContain('.packet-document .store-logo');
 expect(html).toContain('.packet-document .size-box');
 expect(html).not.toContain('${primary}');
});
