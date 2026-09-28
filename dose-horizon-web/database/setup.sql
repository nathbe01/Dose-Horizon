-- Run once in your Supabase project's SQL Editor. Safe to re-run.
-- These are app accounts, not Supabase Auth users. Only the server can access them.
begin;
create schema if not exists extensions;
create extension if not exists pgcrypto with schema extensions;
create schema if not exists dh_private;
revoke all on schema dh_private from public, anon, authenticated;
create table if not exists dh_private.accounts (
 id uuid primary key default gen_random_uuid(),
 username text not null unique check (username ~ '^[a-z0-9_]{3,24}$'),
 pin_hash text not null,
 recovery_hash text not null,
 data jsonb not null default '{}'::jsonb,
 revision integer not null default 0,
 created_at timestamptz not null default now()
);
create table if not exists dh_private.sessions (
 token_hash text primary key,
 account_id uuid not null references dh_private.accounts(id) on delete cascade,
 expires_at timestamptz not null default now()+interval '7 days'
);
create table if not exists dh_private.limits (
 key text primary key, count integer not null, expires_at timestamptz not null
);
alter table dh_private.accounts enable row level security;
alter table dh_private.sessions enable row level security;
alter table dh_private.limits enable row level security;
revoke all on all tables in schema dh_private from public, anon, authenticated;

-- Atomic, shared across all function instances; no in-memory rate limit.
create or replace function dh_private.take_limit(k text, maximum integer, seconds integer)
returns boolean language plpgsql set search_path='' as $$
declare n integer;
begin
 insert into dh_private.limits(key,count,expires_at) values(k,1,now()+make_interval(secs=>seconds))
 on conflict(key) do update set
 count=case when dh_private.limits.expires_at<=now() then 1 else dh_private.limits.count+1 end,
 expires_at=case when dh_private.limits.expires_at<=now() then now()+make_interval(secs=>seconds) else dh_private.limits.expires_at end
 returning count into n;
 return n<=maximum;
end; $$;

-- A single service-only RPC: no user IDs from the browser determine record access.
create or replace function public.dh_account(p_action text, p jsonb)
returns jsonb language plpgsql security definer set search_path='' as $$
declare a dh_private.accounts%rowtype; aid uuid; n integer; ok boolean; hashed text;
begin
 if p_action in ('signup','login','recover') then
  if not dh_private.take_limit('ip:'||(p->>'ip'),30,900) then return jsonb_build_object('error','rate','status',429); end if;
  if not dh_private.take_limit('user:'||(p->>'username'),8,900) then return jsonb_build_object('error','rate','status',429); end if;
  if p_action='signup' then
   if not dh_private.take_limit('signup:'||(p->>'ip'),5,3600) then return jsonb_build_object('error','rate','status',429); end if;
   insert into dh_private.accounts(username,pin_hash,recovery_hash)
    values(p->>'username',extensions.crypt(p->>'proof',extensions.gen_salt('bf',12)),p->>'recoveryHash')
    on conflict(username) do nothing returning * into a;
   if a.id is null then return jsonb_build_object('error','unavailable','status',409); end if;
  else
   select * into a from dh_private.accounts where username=p->>'username' for update;
   if p_action='login' then
    -- Also perform bcrypt work for an unknown username.
    hashed=extensions.crypt(p->>'proof',coalesce(a.pin_hash,'$2a$12$abcdefghijklmnopqrstuu5YBqukJPyDDyJKtz8C1JNXFcsSoPKoa'));
    ok=a.id is not null and hashed=a.pin_hash;
   else
    ok=a.id is not null and a.recovery_hash=p->>'recoveryHash';
   end if;
   if not coalesce(ok,false) then return jsonb_build_object('error','credentials','status',401); end if;
   if p_action='recover' then
    update dh_private.accounts set pin_hash=extensions.crypt(p->>'proof',extensions.gen_salt('bf',12)), recovery_hash=p->>'newRecoveryHash' where id=a.id;
    delete from dh_private.sessions where account_id=a.id;
   end if;
  end if;
  insert into dh_private.sessions(token_hash,account_id) values(p->>'newSessionHash',a.id);
  -- Occasional expired-row cleanup, no private content in logs.
  delete from dh_private.sessions where expires_at<now();
  delete from dh_private.limits where expires_at<now()-interval '1 day';
  return jsonb_build_object('id',a.id,'username',a.username,'data',a.data,'revision',a.revision);
 end if;
 select account_id into aid from dh_private.sessions where token_hash=p->>'sessionHash' and expires_at>now();
 if aid is null then return jsonb_build_object('error','session','status',401); end if;
 if p_action='logout' then
  delete from dh_private.sessions where token_hash=p->>'sessionHash';
  return jsonb_build_object('ok',true);
 end if;
 select * into a from dh_private.accounts where id=aid for update;
 if p_action='session' then return jsonb_build_object('id',a.id,'username',a.username,'data',a.data,'revision',a.revision); end if;
 if p->>'accountId' is distinct from a.id::text then return jsonb_build_object('error','session','status',401); end if;
 if not dh_private.take_limit('write:'||aid::text,180,60) then return jsonb_build_object('error','rate','status',429); end if;
 if p_action='save' then
  if (p->>'revision')::integer<>a.revision then return jsonb_build_object('error','conflict','status',409); end if;
  update dh_private.accounts set data=p->'data',revision=revision+1 where id=aid returning revision into n;
  return jsonb_build_object('revision',n);
 elsif p_action='change-pin' then
  if not dh_private.take_limit('user:'||a.username,8,900) then return jsonb_build_object('error','rate','status',429); end if;
  if extensions.crypt(p->>'oldProof',a.pin_hash)<>a.pin_hash then return jsonb_build_object('error','credentials','status',401); end if;
  update dh_private.accounts set pin_hash=extensions.crypt(p->>'proof',extensions.gen_salt('bf',12)) where id=aid;
  delete from dh_private.sessions where account_id=aid and token_hash<>p->>'sessionHash';
  return jsonb_build_object('ok',true);
 end if;
 return jsonb_build_object('error','request','status',400);
end; $$;
revoke all on function dh_private.take_limit(text,integer,integer) from public,anon,authenticated;
revoke all on function public.dh_account(text,jsonb) from public,anon,authenticated;
grant execute on function public.dh_account(text,jsonb) to service_role;
commit;
