CREATE TABLE IF NOT EXISTS users(id BIGSERIAL PRIMARY KEY,email TEXT UNIQUE NOT NULL,password_hash TEXT NOT NULL,display_name TEXT NOT NULL,username TEXT UNIQUE NOT NULL,created_at TIMESTAMPTZ DEFAULT now());
ALTER TABLE users ADD COLUMN IF NOT EXISTS bio TEXT;
ALTER TABLE users ADD COLUMN IF NOT EXISTS city TEXT;
ALTER TABLE users ADD COLUMN IF NOT EXISTS work TEXT;
ALTER TABLE users ADD COLUMN IF NOT EXISTS education TEXT;
ALTER TABLE users ADD COLUMN IF NOT EXISTS website TEXT;
ALTER TABLE users ADD COLUMN IF NOT EXISTS avatar_url TEXT;
ALTER TABLE users ADD COLUMN IF NOT EXISTS phone TEXT;
CREATE UNIQUE INDEX IF NOT EXISTS users_phone_unique_idx ON users(phone) WHERE phone IS NOT NULL;
CREATE TABLE IF NOT EXISTS posts(id BIGSERIAL PRIMARY KEY,user_id BIGINT REFERENCES users(id) ON DELETE CASCADE,caption TEXT NOT NULL DEFAULT '',visibility TEXT NOT NULL DEFAULT 'public',media_url TEXT,media_type TEXT,album_id BIGINT,created_at TIMESTAMPTZ DEFAULT now());
CREATE TABLE IF NOT EXISTS likes(user_id BIGINT REFERENCES users(id) ON DELETE CASCADE,post_id BIGINT REFERENCES posts(id) ON DELETE CASCADE,created_at TIMESTAMPTZ DEFAULT now(),PRIMARY KEY(user_id,post_id));
CREATE TABLE IF NOT EXISTS comments(id BIGSERIAL PRIMARY KEY,user_id BIGINT REFERENCES users(id) ON DELETE CASCADE,post_id BIGINT REFERENCES posts(id) ON DELETE CASCADE,body TEXT NOT NULL,created_at TIMESTAMPTZ DEFAULT now());
CREATE TABLE IF NOT EXISTS shares(id BIGSERIAL PRIMARY KEY,user_id BIGINT REFERENCES users(id) ON DELETE CASCADE,post_id BIGINT REFERENCES posts(id) ON DELETE CASCADE,share_type TEXT DEFAULT 'internal',created_at TIMESTAMPTZ DEFAULT now());
CREATE TABLE IF NOT EXISTS views(user_id BIGINT REFERENCES users(id) ON DELETE CASCADE,post_id BIGINT REFERENCES posts(id) ON DELETE CASCADE,created_at TIMESTAMPTZ DEFAULT now(),PRIMARY KEY(user_id,post_id));
CREATE TABLE IF NOT EXISTS notifications(id BIGSERIAL PRIMARY KEY,user_id BIGINT REFERENCES users(id) ON DELETE CASCADE,type TEXT,message TEXT,created_at TIMESTAMPTZ DEFAULT now(),read_at TIMESTAMPTZ);
CREATE TABLE IF NOT EXISTS messages(id BIGSERIAL PRIMARY KEY,sender_id BIGINT REFERENCES users(id) ON DELETE CASCADE,receiver_id BIGINT REFERENCES users(id) ON DELETE CASCADE,body TEXT NOT NULL,created_at TIMESTAMPTZ DEFAULT now(),read_at TIMESTAMPTZ);
CREATE INDEX IF NOT EXISTS messages_sender_receiver_idx ON messages(sender_id,receiver_id,created_at);
CREATE INDEX IF NOT EXISTS messages_receiver_sender_idx ON messages(receiver_id,sender_id,created_at);
CREATE TABLE IF NOT EXISTS creators(user_id BIGINT PRIMARY KEY REFERENCES users(id) ON DELETE CASCADE,balance NUMERIC(14,2) DEFAULT 0,pending_balance NUMERIC(14,2) DEFAULT 0,lifetime_earnings NUMERIC(14,2) DEFAULT 0,created_at TIMESTAMPTZ DEFAULT now());
CREATE TABLE IF NOT EXISTS payouts(id BIGSERIAL PRIMARY KEY,user_id BIGINT REFERENCES users(id) ON DELETE CASCADE,amount NUMERIC(14,2) NOT NULL,status TEXT DEFAULT 'pending',created_at TIMESTAMPTZ DEFAULT now());

CREATE TABLE IF NOT EXISTS follows(follower_id BIGINT REFERENCES users(id) ON DELETE CASCADE,following_id BIGINT REFERENCES users(id) ON DELETE CASCADE,created_at TIMESTAMPTZ DEFAULT now(),PRIMARY KEY(follower_id,following_id),CHECK(follower_id<>following_id));
CREATE INDEX IF NOT EXISTS follows_following_idx ON follows(following_id,created_at);
CREATE INDEX IF NOT EXISTS follows_follower_idx ON follows(follower_id,created_at);

ALTER TABLE posts ADD COLUMN IF NOT EXISTS album_id BIGINT;
CREATE TABLE IF NOT EXISTS albums(
  id BIGSERIAL PRIMARY KEY,
  user_id BIGINT REFERENCES users(id) ON DELETE CASCADE,
  name TEXT NOT NULL,
  album_type TEXT NOT NULL CHECK(album_type IN ('photo','video')),
  created_at TIMESTAMPTZ DEFAULT now(),
  updated_at TIMESTAMPTZ DEFAULT now()
);
CREATE INDEX IF NOT EXISTS albums_user_type_idx ON albums(user_id,album_type,created_at);
CREATE INDEX IF NOT EXISTS posts_album_idx ON posts(album_id,created_at);

CREATE TABLE IF NOT EXISTS post_audience_users(post_id BIGINT REFERENCES posts(id) ON DELETE CASCADE,user_id BIGINT REFERENCES users(id) ON DELETE CASCADE,PRIMARY KEY(post_id,user_id));
CREATE INDEX IF NOT EXISTS post_audience_user_idx ON post_audience_users(user_id,post_id);
CREATE TABLE IF NOT EXISTS live_streams(id BIGSERIAL PRIMARY KEY,user_id BIGINT REFERENCES users(id) ON DELETE CASCADE,title TEXT NOT NULL DEFAULT 'Siaran langsung RAVIXO',status TEXT NOT NULL DEFAULT 'live' CHECK(status IN ('live','ended')),created_at TIMESTAMPTZ DEFAULT now(),ended_at TIMESTAMPTZ);
CREATE INDEX IF NOT EXISTS live_streams_user_status_idx ON live_streams(user_id,status,created_at);
