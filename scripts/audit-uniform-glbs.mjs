import fs from 'node:fs';
import path from 'node:path';

const root = path.resolve(process.cwd(), 'public/uniform');
const requested = process.argv.slice(2).filter((argument) => !['--json', '--matrix'].includes(argument));
const resolveRequested = (name) => {
  if (path.isAbsolute(name)) return name;
  const fromCwd = path.resolve(process.cwd(), name);
  return fs.existsSync(fromCwd) ? fromCwd : path.resolve(root, name);
};
const expandRequested = (file) => {
  if (!fs.statSync(file).isDirectory()) return [file];
  return fs.readdirSync(file, { withFileTypes: true })
    .flatMap((entry) => entry.isDirectory()
      ? expandRequested(path.join(file, entry.name))
      : entry.name.toLowerCase().endsWith('.glb') ? [path.join(file, entry.name)] : []);
};
const files = requested.length
  ? requested.map(resolveRequested).flatMap(expandRequested).sort()
  : fs.readdirSync(root).filter((name) => name.endsWith('.glb')).map((name) => path.join(root, name));

function readGlbJson(file) {
  const bytes = fs.readFileSync(file);
  if (bytes.toString('ascii', 0, 4) !== 'glTF') throw new Error('Not a binary glTF file');
  if (bytes.readUInt32LE(4) !== 2) throw new Error('Only GLB 2.0 is supported');
  let offset = 12;
  while (offset + 8 <= bytes.length) {
    const length = bytes.readUInt32LE(offset);
    const type = bytes.readUInt32LE(offset + 4);
    const body = bytes.subarray(offset + 8, offset + 8 + length);
    if (type === 0x4e4f534a) return JSON.parse(body.toString('utf8').replace(/\0+$/g, '').trim());
    offset += 8 + length;
  }
  throw new Error('GLB has no JSON chunk');
}

function primitiveTriangles(primitive, accessors = []) {
  const accessor = accessors[primitive.indices ?? primitive.attributes?.POSITION];
  const count = accessor?.count || 0;
  switch (primitive.mode ?? 4) {
    case 4: return Math.floor(count / 3);
    case 5:
    case 6: return Math.max(0, count - 2);
    default: return 0;
  }
}

function audit(file) {
  const gltf = readGlbJson(file);
  const primitives = (gltf.meshes || []).flatMap((mesh) =>
    (mesh.primitives || []).map((primitive) => ({ mesh: mesh.name || '(unnamed)', primitive }))
  );
  const materialUse = new Map();
  const attributes = new Set();
  for (const { primitive } of primitives) {
    Object.keys(primitive.attributes || {}).forEach((name) => attributes.add(name));
    const material = gltf.materials?.[primitive.material];
    const name = material?.name || `(material ${primitive.material ?? 'none'})`;
    materialUse.set(name, (materialUse.get(name) || 0) + 1);
  }
  const totalTriangles = primitives.reduce((sum, item) => sum + primitiveTriangles(item.primitive, gltf.accessors), 0);
  const materials = gltf.materials || [];
  const normalMaterials = materials.filter((material) => material.normalTexture).map((material) => material.name || '(unnamed)');
  const pbrMaterials = materials.filter((material) => material.pbrMetallicRoughness).length;
  const transparentMaterials = materials.filter((material) => material.alphaMode && material.alphaMode !== 'OPAQUE').length;
  const namedNodes = (gltf.nodes || []).map((node) => node.name).filter(Boolean);
  const namedMeshes = (gltf.meshes || []).map((mesh) => mesh.name).filter(Boolean);
  const namedMaterials = materials.map((material) => material.name).filter(Boolean);
  const zoneTerms = namedNodes.filter((name) => /body|front|back|sleeve|side|collar|cuff|stripe|band|stitch|waist|leg/i.test(name));
  const extensions = new Set([
    ...Object.keys(gltf.extensions || {}),
    ...(gltf.extensionsUsed || []),
    ...materials.flatMap((material) => Object.keys(material.extensions || {})),
  ]);
  return {
    file: path.basename(file),
    bytes: fs.statSync(file).size,
    nodes: gltf.nodes?.length || 0,
    meshes: gltf.meshes?.length || 0,
    primitives: primitives.length,
    triangles: totalTriangles,
    materials: materials.length,
    pbrMaterials,
    normalMaterials,
    textures: gltf.textures?.length || 0,
    images: gltf.images?.length || 0,
    hasUv0: attributes.has('TEXCOORD_0'),
    hasTangents: attributes.has('TANGENT'),
    hasNormals: attributes.has('NORMAL'),
    transparentMaterials,
    materialUse: Object.fromEntries(materialUse),
    namedNodes,
    namedMeshes,
    namedMaterials,
    zoneTerms,
    extensions: [...extensions],
  };
}

const results = [];
for (const file of files) {
  try { results.push(audit(file)); }
  catch (error) { results.push({ file: path.basename(file), error: error.message }); }
}

if (process.argv.includes('--json')) {
  console.log(JSON.stringify(results, null, 2));
} else if (process.argv.includes('--matrix')) {
  for (const item of results) {
    if (item.error) {
      console.log([item.file, 'ERROR', item.error].join('\t'));
      continue;
    }
    console.log([
      item.file,
      item.meshes,
      item.primitives,
      item.triangles,
      item.materials,
      item.hasUv0 ? 'uv' : 'NO_UV',
      item.hasTangents ? 'tangent' : 'no-tangent',
      item.normalMaterials.length ? 'normal-map' : 'no-normal-map',
      item.namedMaterials.join('|') || '-',
      item.namedMeshes.join('|') || '-',
    ].join('\t'));
  }
} else {
  const mb = (bytes) => `${(bytes / 1024 / 1024).toFixed(2)} MB`;
  for (const item of results) {
    if (item.error) { console.log(`${item.file}: ERROR ${item.error}`); continue; }
    console.log(`\n${item.file} (${mb(item.bytes)})`);
    console.log(`  ${item.meshes} meshes / ${item.primitives} primitives / ${item.triangles.toLocaleString()} triangles / ${item.materials} materials`);
    console.log(`  UV0 ${item.hasUv0 ? 'yes' : 'NO'} | normals ${item.hasNormals ? 'yes' : 'NO'} | tangents ${item.hasTangents ? 'yes' : 'no'} | texture images ${item.images} | normal maps ${item.normalMaterials.length}`);
    console.log(`  material use: ${Object.entries(item.materialUse).map(([name, count]) => `${name}×${count}`).join(', ') || 'none'}`);
    console.log(`  mesh names: ${item.namedMeshes.join(', ') || 'none named'}`);
    console.log(`  material names: ${item.namedMaterials.join(', ') || 'none named'}`);
    console.log(`  garment zones: ${item.zoneTerms.join(', ') || 'none named'}`);
    console.log(`  extensions: ${item.extensions.join(', ') || 'none'}`);
  }
}
