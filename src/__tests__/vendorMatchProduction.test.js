/** @jest-environment node */
const fs=require('fs');
const path=require('path');
const babel=require('@babel/core');
const vm=require('vm');
test('browser production transform preserves the shared CommonJS vendor matcher',()=>{
 const filename=path.resolve(__dirname,'../lib/vendorColorMatch.shared.js');
 const {code}=babel.transformSync(fs.readFileSync(filename,'utf8'),{filename,caller:{name:'babel-loader',supportsStaticESM:true,supportsDynamicImport:true},babelrc:false,configFile:false,presets:[[require.resolve('babel-preset-react-app'),{runtime:'automatic'}]],envName:'production'});
 expect(code).not.toMatch(/\bimport\s/);
 const module={exports:{}};vm.runInNewContext(code,{module,exports:module.exports});
 expect(module.exports.ssStyleSearchVariants('BC3945')).toEqual([{code:'BC3945',strict:false},{code:'3945',strict:true,brand:'Bella'}]);
});

// These CommonJS helpers are loaded by the browser and by Netlify functions.
test.each(['vendorColorMatch.shared.js','vendorOrderGuards.shared.js','ssOrder.shared.js','sanmarPO.shared.js'])('%s does not acquire ESM imports in the production browser build',name=>{
 const filename=path.resolve(__dirname,'../lib',name);
 const {ast}=babel.transformFileSync(filename,{ast:true,caller:{name:'babel-loader',supportsStaticESM:true,supportsDynamicImport:true},babelrc:false,configFile:false,presets:[[require.resolve('babel-preset-react-app'),{runtime:'automatic'}]],envName:'production'});
 expect(ast.program.body.filter(node=>node.type==='ImportDeclaration')).toEqual([]);
});
