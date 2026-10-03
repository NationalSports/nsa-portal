/** @jest-environment node */
import {editPixels, paletteOf} from '../lib/imageEdits';
const white=[255,255,255,255], black=[0,0,0,255], red=[160,20,40,255];
test('background removal preserves enclosed white artwork',()=>{
 const pixels=new Uint8ClampedArray([
 ...white,...white,...white,...white,...white,
 ...white,...black,...black,...black,...white,
 ...white,...black,...white,...black,...white,
 ...white,...black,...black,...black,...white,
 ...white,...white,...white,...white,...white]);
 const output=editPixels(pixels,5,5,{background:'#ffffff'});
 expect(output[3]).toBe(0); expect(output[12*4+3]).toBe(255); expect(output[6*4+3]).toBe(255);
 expect(pixels[3]).toBe(255);
});
test('global color removal removes enclosed color and preserves existing alpha',()=>{
 const pixels=new Uint8ClampedArray([...white,...red,255,255,255,0]);
 expect(Array.from(editPixels(pixels,3,1,{colors:{'#ffffff':null}}))).toEqual([255,255,255,0,...red,255,255,255,0]);
});
test('replacements use original colors without cascading',()=>{
 const pixels=new Uint8ClampedArray([...red,...black]);
 expect(Array.from(editPixels(pixels,2,1,{colors:{'#a01428':'#000000','#000000':'#ffffff'}}))).toEqual([...black,...white]);
});
test('tolerance controls edge matching and no options is lossless',()=>{
 const pixels=new Uint8ClampedArray([245,245,245,255,...white]);
 expect(editPixels(pixels,2,1,{background:'#ffffff',tolerance:5})[3]).toBe(255);
 expect(editPixels(pixels,2,1,{background:'#ffffff',tolerance:10})[3]).toBe(0);
 expect(editPixels(pixels,2,1)).toEqual(pixels);
});
test('palette ignores transparent pixels and orders prevalent colors first',()=>{
 expect(paletteOf(new Uint8ClampedArray([...red,...white,...red,0,0,0,0]))).toEqual(['#a01428','#ffffff']);
});
