import assert from 'node:assert/strict';
import { describe,it } from 'node:test';
import { eventDetail,groupNavigationRecords,formatRecordTime,type LedgerEvent } from './ledger-model.ts';
const event=(id:string,at:string,navigationKey?:string):LedgerEvent=>({id,occurredAt:at,label:navigationKey?'Viewed Calendar':'Journal saved',detail:'',category:navigationKey?'screen view':'journal usage',navigationKey});
describe('readable activity presentation',()=>{
 it('groups consecutive navigation records and retains every original record in order',()=>{
  const records=[event('a','2026-10-26T19:00:30Z','/'),event('b','2026-10-26T19:00:20Z','/'),event('c','2026-10-26T19:00:10Z','/'),event('save','2026-10-26T19:00:05Z'),event('d','2026-10-26T19:00:01Z','/')];
  const groups=groupNavigationRecords(records);
  assert.deepEqual(groups.map(g=>g.length),[3,1,1]);
  assert.deepEqual(groups.flat().map(x=>x.id),records.map(x=>x.id));
 });
 it('does not group across another screen or a two-minute span',()=>{
  const records=[event('a','2026-10-26T19:03:00Z','/'),event('b','2026-10-26T19:00:59Z','/'),event('c','2026-10-26T19:00:55Z','/journal'),event('d','2026-10-26T19:00:50Z','/')];
  assert.equal(groupNavigationRecords(records).length,4);
 });
 it('does not collapse unclassified records or authored actions',()=>{
  assert.deepEqual(groupNavigationRecords([event('a','2026-10-26T19:00:02Z'),event('b','2026-10-26T19:00:01Z')]).map(g=>g.length),[1,1]);
 });
 it('shows useful allowlisted metadata without raw routes or private fields',()=>{
  assert.equal(eventDetail({node_title:'Ra',node_slug:'ra',context_label:'From Pages',char_count:64,route:'/',body:'PRIVATE',message:'PRIVATE',title:'PRIVATE',target_id:'PRIVATE'}),'Ra · From Pages · 64 characters saved');
  assert.equal(eventDetail({body:'PRIVATE',route:'/',char_count:-1}),'');
  assert.equal(eventDetail({char_count:'64'}),'');
 });
 it('keeps second-resolution timestamps available for repeated records',()=>{
  assert.match(formatRecordTime(new Date('2026-10-26T19:00:03Z'),'America/Los_Angeles'),/12:00:03/);
 });
});
