import { test } from 'node:test';
import assert from 'node:assert/strict';
import { suggestFromPhoto } from '../dist/photo.js';
const catalog = {version:1,items:[{id:'chair',category:'chair',dimensions:[0.5,1,0.5]}, {id:'sofa',category:'sofa',dimensions:[2,1,1]}]};
const detection = {id:'photo-chair',category:'chair',score:.9,pixelBox:[10,20,50,90]};
test('photo pixels never become metric dimensions or placement', () => {
  const result = suggestFromPhoto(detection,catalog);
  assert.equal(result.measured,null);
  assert.deepEqual(result.categoryIds,['chair']);
  assert.equal(result.status,'needs-measurement');
});
test('unknown and low-confidence categories do not suggest furniture', () => {
  for (const d of [{...detection,score:.3},{...detection,category:'unknown'}])
    assert.deepEqual(suggestFromPhoto(d,catalog).categoryIds,[]);
});
test('confirmed scan geometry determines scaling, independent of photo pixel size', () => {
  const measurement={box:{center:[2,.5,3],dimensions:[.6,1,.5],yaw:0},source:'linked-scan',associationConfirmed:true};
  const a=suggestFromPhoto(detection,catalog,measurement);
  const b=suggestFromPhoto({...detection,pixelBox:[100,200,500,900]},catalog,measurement);
  assert.deepEqual(a.measured,b.measured);
  assert.equal(a.measured.candidates[0].transform.scale[0],1.2);
});
test('rejects unconfirmed associations and malformed detections', () => {
  assert.throws(()=>suggestFromPhoto(detection,catalog,{associationConfirmed:false}));
  for(const pixelBox of [[0,0,0,2],[0,0,NaN,2],[-1,0,2,3]])
    assert.throws(()=>suggestFromPhoto({...detection,pixelBox},catalog));
});
