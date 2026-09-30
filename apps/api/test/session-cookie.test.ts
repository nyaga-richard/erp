import {test} from 'node:test';
import assert from 'node:assert/strict';
import {sessionCookieOptions,sessionCookieName} from '../src/session-cookie';
test('same-origin cookie policy remains strict by default',()=>{assert.deepEqual(sessionCookieOptions({}),{httpOnly:true,secure:false,sameSite:'strict',path:'/'});});
test('embedded sessions require secure HttpOnly partitioned cookies',()=>{assert.deepEqual(sessionCookieOptions({SESSION_COOKIE_MODE:'partitioned',COOKIE_SECURE:'true'}),{httpOnly:true,secure:true,sameSite:'none',partitioned:true,path:'/'});});
test('insecure embedded/production and unknown cookie modes fail closed',()=>{assert.throws(()=>sessionCookieOptions({SESSION_COOKIE_MODE:'partitioned'}),/Secure/);assert.throws(()=>sessionCookieOptions({NODE_ENV:'production'}),/Secure/);assert.throws(()=>sessionCookieOptions({SESSION_COOKIE_MODE:'none'}),/must be/);});

test('preview cookie has a distinct host-only namespace',()=>{assert.equal(sessionCookieName({}),'erp_session');assert.equal(sessionCookieName({SESSION_COOKIE_MODE:'partitioned'}),'__Host-erp_preview');});

import {previewMemorySessionsEnabled} from '../src/preview-session';
test('preview memory transport is opt-in and forbidden in production',()=>{assert.equal(previewMemorySessionsEnabled({}),false);assert.equal(previewMemorySessionsEnabled({ENABLE_PREVIEW_MEMORY_SESSION:'true'}),true);assert.throws(()=>previewMemorySessionsEnabled({ENABLE_PREVIEW_MEMORY_SESSION:'true',NODE_ENV:'production'}),/production/);});

test('preview flag rejects ambiguous values',()=>assert.throws(()=>previewMemorySessionsEnabled({ENABLE_PREVIEW_MEMORY_SESSION:'yes'}),/true or false/));
