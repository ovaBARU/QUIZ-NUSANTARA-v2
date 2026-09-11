const API_BASE=window.RAVIXO_API_BASE||'/api',TOKEN_KEY='ravixo_token';
let currentUser=null,currentPosts=[],selectedPost=null,selectedMedia=[],authMode='login',selectedChatUser=null,chatPoll=null,notificationPoll=null,currentFriendTab='friends',currentAlbumType=null,googleClientId='',googleInitialized=false,googlePendingCredential='';
const $=s=>document.querySelector(s),$$=s=>[...document.querySelectorAll(s)];
const esc=v=>String(v??'').replace(/[&<>'"]/g,c=>({'&':'&amp;','<':'&lt;','>':'&gt;',"'":'&#39;','"':'&quot;'}[c]));
const initials=n=>(String(n||'RV').trim().split(/\s+/).slice(0,2).map(x=>x[0]).join('').toUpperCase()||'RV');
const money=v=>new Intl.NumberFormat('id-ID',{style:'currency',currency:'IDR',maximumFractionDigits:0}).format(Number(v)||0);
const token=()=>localStorage.getItem(TOKEN_KEY);
function avatarInner(u,size=''){const name=initials(u?.display_name||u?.username);return u?.avatar_url?`<img class="avatar-img ${size}" src="${esc(u.avatar_url)}" alt="Foto profil ${esc(u.display_name||u.username||'RAVIXO')}" loading="lazy">`:esc(name)}
function avatarHTML(u,cls=''){const click=u?.id?` clickable-avatar data-profile-id="${esc(u.id)}"`:'';return `<span class="avatar ${cls}${u?.id?' clickable-avatar':''}"${click}>${avatarInner(u)}</span>`}
function status(m,error=false){const e=$('#status');if(!e)return;e.textContent=m||'';e.className='status'+(error?' error':'');if(m)setTimeout(()=>{e.textContent='';e.className='status'},4000)}
async function api(path,opt={}){const h={'Content-Type':'application/json',...(opt.headers||{})};if(token())h.Authorization=`Bearer ${token()}`;let r;try{r=await fetch(API_BASE+path,{...opt,headers:h})}catch{throw new Error('Tidak dapat terhubung ke server RAVIXO.')}const text=await r.text();let d={};try{d=text?JSON.parse(text):{}}catch{d={error:'Server mengirim respons yang tidak valid.'}}if(r.status===401){localStorage.removeItem(TOKEN_KEY);currentUser=null;updateUserUI()}if(!r.ok)throw new Error(d.error||`API error (${r.status})`);return d}
function open(id){$('#'+id)?.classList.remove('hidden')}function close(id){$('#'+id)?.classList.add('hidden')}
function requireLogin(){if(currentUser)return true;open('authModal');status('Silakan masuk terlebih dahulu.',true);return false}
function startNotificationPolling(){if(notificationPoll)clearInterval(notificationPoll);updateNotificationBadge();notificationPoll=setInterval(updateNotificationBadge,5000)}
function stopNotificationPolling(){if(notificationPoll)clearInterval(notificationPoll);notificationPoll=null;$('#notificationBadge')?.classList.add('hidden')}
function updateUserUI(){const name=currentUser?.display_name||'Tamu RAVIXO',u=currentUser?'@'+currentUser.username:'Belum login',i=initials(name);$('#sideName').textContent=name;$('#sideUsername').textContent=u;$('#sideAvatar').innerHTML=avatarInner(currentUser);$('#composerAvatar').innerHTML=avatarInner(currentUser);$('#profileBtn').innerHTML=avatarInner(currentUser);$('#authSideBtn').textContent=currentUser?'Keluar':'Masuk / Daftar'}
async function loadMe(){if(!token()){updateUserUI();stopNotificationPolling();return}try{currentUser=(await api('/me')).user;updateUserUI();startNotificationPolling()}catch{localStorage.removeItem(TOKEN_KEY);currentUser=null;stopNotificationPolling();updateUserUI()}}
function mediaHTML(p){if(!p.media_url)return '';const url=esc(p.media_url);return p.media_type==='video'?`<video class="media realmedia portrait-friendly-video" src="${url}" controls preload="metadata"></video>`:`<img class="media realmedia" src="${url}" alt="Media postingan" loading="lazy">`}
function openMediaViewer(url,type='image',caption=''){const viewer=$('#mediaViewer'),stage=$('#mediaViewerStage'),cap=$('#mediaViewerCaption');if(!viewer||!stage)return;stage.innerHTML=type==='video'?`<video src="${esc(url)}" controls autoplay playsinline></video>`:`<img src="${esc(url)}" alt="Media diperbesar">`;cap.textContent=caption||'';viewer.classList.remove('hidden');viewer.setAttribute('aria-hidden','false');document.body.classList.add('media-viewer-open')}
function closeMediaViewer(){const viewer=$('#mediaViewer'),stage=$('#mediaViewerStage');if(!viewer)return;viewer.classList.add('hidden');viewer.setAttribute('aria-hidden','true');if(stage)stage.innerHTML='';document.body.classList.remove('media-viewer-open')}
function attachMediaViewer(){
  $$('.realmedia,.album-media-photo,.album-media-video').forEach(el=>{
    if(el.dataset.viewerBound)return;
    el.dataset.viewerBound='1';
    el.addEventListener('click',e=>{
      e.preventDefault();e.stopPropagation();
      openMediaViewer(el.currentSrc||el.src,el.tagName==='VIDEO'?'video':'image',el.alt||'')
    })
  });
  $$('.profile-avatar-large,.settings-avatar').forEach(el=>{
    if(el.dataset.viewerBound)return;
    const img=el.querySelector('img')||el;
    if(!img?.src)return;
    el.dataset.viewerBound='1';
    el.addEventListener('click',e=>{
      e.preventDefault();e.stopPropagation();
      openMediaViewer(img.currentSrc||img.src,'image','Foto profil')
    })
  });
}

function visibilityLabel(v){return v==='private'?'🔒 Privat':v==='friends'?'👥 Teman':v==='selected'?'⭐ Teman terpilih':'🌎 Publik'}

function postCard(p){const liked=!!p.liked,isMine=currentUser&&String(currentUser.id)===String(p.user_id);return `<article class="post" data-post-id="${esc(p.id)}"><div class="head">${avatarHTML({display_name:p.display_name,username:p.username,avatar_url:p.avatar_url})}<div><b class="clickable-user" data-profile-id="${esc(p.user_id)}">${esc(p.display_name||p.username||'Pengguna RAVIXO')}</b><small>@${esc(p.username||'')} · ${new Date(p.created_at).toLocaleString('id-ID')} · ${visibilityLabel(p.visibility)}</small></div>${!isMine&&currentUser?`<button class="follow-btn ${p.is_following?'following':''}" data-user-id="${esc(p.user_id)}" data-following="${p.is_following?'1':'0'}">${p.is_following&&p.is_followed_by?'👥 Teman':p.is_following?'✓ Mengikuti':'+ Ikuti'}</button>`:''}</div><p>${esc(p.caption||'')}</p>${mediaHTML(p)}<div class="stats">❤️ ${Number(p.likes_count)||0}　 💬 ${Number(p.comments_count)||0} komentar　 ↗ ${Number(p.shares_count)||0} dibagikan　 👁 ${Number(p.views_count)||0}</div><div class="actions"><button class="like-btn" data-id="${esc(p.id)}">${liked?'❤️ Disukai':'❤️ Suka'}</button><button class="comment-btn" data-id="${esc(p.id)}">💬 Komentar</button><button class="share-btn" data-id="${esc(p.id)}">↗ Bagikan</button>${isMine?`<button class="delete-post-btn" data-id="${esc(p.id)}">🗑️ Hapus</button>`:''}</div></article>`}
async function loadFeed(q=''){const feed=$('#feed');feed.innerHTML='<div class="loading">Memuat feed RAVIXO...</div>';try{const d=await api('/posts?limit=50'+(q?'&q='+encodeURIComponent(q):''));currentPosts=d.posts||[];feed.innerHTML=currentPosts.length?currentPosts.map(postCard).join(''):'<div class="panel empty">Belum ada postingan.</div>';attachPostEvents();attachMediaViewer()}catch(e){feed.innerHTML='<div class="panel empty">Feed gagal dimuat.</div>';status(e.message,true)}}
async function deletePost(id,btn){if(!requireLogin())return;if(!confirm('Hapus postingan ini? Tindakan ini tidak dapat dibatalkan.'))return;if(btn)btn.disabled=true;try{await api('/posts/'+id,{method:'DELETE'});status('Postingan berhasil dihapus.');await loadFeed($('#searchInput').value.trim())}catch(e){status(e.message,true)}finally{if(btn)btn.disabled=false}}
function attachPostEvents(){$$('.like-btn').forEach(b=>b.onclick=()=>likePost(b.dataset.id,b));$$('.comment-btn').forEach(b=>b.onclick=()=>showComments(b.dataset.id));$$('.share-btn').forEach(b=>b.onclick=()=>sharePost(b.dataset.id));$$('.delete-post-btn').forEach(b=>b.onclick=()=>deletePost(b.dataset.id,b));$$('.follow-btn').forEach(b=>b.onclick=()=>toggleFollow(b.dataset.userId,b));$$('.clickable-user,.clickable-avatar').forEach(b=>b.onclick=()=>showProfile(Number(b.dataset.profileId)));const seen=new Set();const obs='IntersectionObserver'in window?new IntersectionObserver(es=>es.forEach(x=>{if(x.isIntersecting){const id=x.target.dataset.postId;if(!seen.has(id)){seen.add(id);api(`/posts/${id}/view`,{method:'POST'}).catch(()=>{})}}}),{threshold:.5}):null;$$('.post').forEach(c=>obs?.observe(c))}
async function likePost(id,b){if(!requireLogin())return;try{await api(`/posts/${id}/like`,{method:b.textContent.includes('Disukai')?'DELETE':'POST'});await loadFeed($('#searchInput').value.trim())}catch(e){status(e.message,true)}}
async function sharePost(id){if(!requireLogin())return;try{await api(`/posts/${id}/share`,{method:'POST',body:JSON.stringify({share_type:'internal'})});status('Postingan berhasil dibagikan.');await loadFeed($('#searchInput').value.trim())}catch(e){status(e.message,true)}}
function followLabel(u){return u.is_following&&u.is_followed_by?'👥 Teman':u.is_following?'✓ Mengikuti':'+ Ikuti'}
function followClass(u){return u.is_following?'following':''}
async function toggleFollow(userId,b){if(!requireLogin())return;const following=b.dataset.following==='1';b.disabled=true;try{await api(`/users/${userId}/follow`,{method:following?'DELETE':'POST'});const fresh=(await api(`/users/${userId}`)).user;b.dataset.following=fresh.is_following?'1':'0';b.classList.toggle('following',!!fresh.is_following);b.textContent=followLabel(fresh);status(fresh.is_following&&fresh.is_followed_by?'Sekarang kalian berteman.':fresh.is_following?'Sekarang mengikuti pengguna.':'Berhenti mengikuti pengguna.');await loadFeed($('#searchInput').value.trim());if(!$('#friendsPanel')?.classList.contains('hidden'))loadFriends(currentFriendTab,$('#friendSearch')?.value.trim()||'')}catch(e){status(e.message,true)}finally{b.disabled=false}}
let profileWindowUser=null,profileWindowTab='home';
function profileTabButton(tab,label){return `<button class="profile-window-tab ${profileWindowTab===tab?'active':''}" data-profile-tab="${tab}">${label}</button>`}
function profileListHTML(users,empty){return (users||[]).map(u=>`<div class="profile-list-row"><div class="profile-list-person">${avatarHTML(u)}<div><b class="clickable-user" data-profile-id="${u.id}">${esc(u.display_name)}</b><small>@${esc(u.username)}</small></div></div></div>`).join('')||`<div class="profile-window-empty">${empty}</div>`}
async function showProfile(id,tab='home'){
  if(!requireLogin())return;
  const modal=$('#profileModal'),box=$('#profileContent');
  profileWindowTab=tab; open('profileModal'); box.innerHTML='<div class="loading">Memuat profil...</div>';
  try{
    const u=(await api(`/users/${id}`)).user; profileWindowUser=u;
    const mine=String(currentUser.id)===String(u.id);
    const aboutBits=[u.bio?`<p class="profile-bio">${esc(u.bio)}</p>`:'',u.city?`<div>📍 <b>Tinggal di</b> ${esc(u.city)}</div>`:'',u.work?`<div>💼 <b>Bekerja sebagai</b> ${esc(u.work)}</div>`:'',u.education?`<div>🎓 <b>Pendidikan</b> ${esc(u.education)}</div>`:'',u.website?`<div>🔗 <a href="${esc(u.website)}" target="_blank" rel="noopener noreferrer">${esc(u.website)}</a></div>`:''].filter(Boolean).join('');
    box.innerHTML=`
      <div class="profile-window-head">
        <div class="profile-window-cover"><div class="profile-cover-pattern">RAVIXO</div></div>
        <button class="profile-window-close" data-close="profileModal" aria-label="Tutup">×</button>
        <div class="profile-window-identity">
          ${avatarHTML(u,'profile-avatar-large')}
          <div class="profile-window-name"><h1>${esc(u.display_name)} <span class="profile-window-handle">(@${esc(u.username)})</span></h1><div class="profile-window-subtitle">${u.bio?esc(u.bio):'Kreator di RAVIXO'}</div></div>
          <div class="profile-window-actions">${mine?`<button id="editOwnProfile" class="secondary">✏️ Edit Profil</button>`:`<button id="profileFollowBtn" class="follow-btn ${followClass(u)}" data-user-id="${u.id}" data-following="${u.is_following?'1':'0'}">${followLabel(u)}</button>`}</div>
        </div>
        <div class="profile-window-stats"><span><b>${Number(u.followers_count)||0}</b> Pengikut</span><span><b>${Number(u.following_count)||0}</b> Mengikuti</span><span><b>${Number(u.posts_count)||0}</b> Postingan</span></div>
        <nav class="profile-window-tabs">${profileTabButton('home','Semua')}${profileTabButton('about','Tentang')}${profileTabButton('video','Reels')}${profileTabButton('photo','Foto')}${profileTabButton('friends','Teman')}${profileTabButton('following','Mengikuti')}${profileTabButton('followers','Pengikut')}${profileTabButton('photo-albums','Album Foto')}${profileTabButton('video-albums','Album Video')}</nav>
      </div>
      <div id="profileWindowBody" class="profile-window-body"></div>`;
    $('#profileModal').querySelector('.modal-close')?.remove();
    $('#profileModal').querySelector('[data-close="profileModal"]')?.addEventListener('click',()=>close('profileModal'));
    const pa=$('#profileModal .profile-avatar-large'); if(pa&&u.avatar_url){pa.addEventListener('click',e=>{e.preventDefault();e.stopPropagation();openMediaViewer(u.avatar_url,'image','Foto profil '+(u.display_name||u.username||''))})}
    $('#editOwnProfile')?.addEventListener('click',()=>{close('profileModal');showSettings()});
    $('#profileFollowBtn')?.addEventListener('click',async()=>{const b=$('#profileFollowBtn');await toggleFollow(b.dataset.userId,b);const fresh=(await api(`/users/${id}`)).user;profileWindowUser=fresh;$('#profileModal .profile-window-stats').innerHTML=`<span><b>${Number(fresh.followers_count)||0}</b> Pengikut</span><span><b>${Number(fresh.following_count)||0}</b> Mengikuti</span><span><b>${Number(fresh.posts_count)||0}</b> Postingan</span>`;b.textContent=followLabel(fresh);b.classList.toggle('following',!!fresh.is_following);b.dataset.following=fresh.is_following?'1':'0'});
    $$('.profile-window-tab').forEach(b=>b.onclick=()=>{profileWindowTab=b.dataset.profileTab;$$('.profile-window-tab').forEach(x=>x.classList.toggle('active',x===b));loadProfileWindowTab(id,profileWindowTab)});
    await loadProfileWindowTab(id,tab);
  }catch(e){box.innerHTML=`<p class="muted">${esc(e.message)}</p>`}
}
async function loadProfileWindowTab(id,tab){
  const body=$('#profileWindowBody'); if(!body)return; body.innerHTML='<div class="loading">Memuat...</div>';
  try{
    if(tab==='home'||tab==='photo'||tab==='video'){
      const u=profileWindowUser; const d=await api(`/users/${id}/posts`); let posts=d.posts||[]; let activeLive=null; try{activeLive=(await api(`/live/active/${id}`)).stream}catch{}
      if(tab==='photo')posts=posts.filter(p=>p.media_type==='image');
      if(tab==='video')posts=posts.filter(p=>p.media_type==='video');
      const details=[u.bio?`<p class="profile-bio">${esc(u.bio)}</p>`:'',u.city?`<div>📍 Tinggal di <b>${esc(u.city)}</b></div>`:'',u.work?`<div>💼 Bekerja sebagai <b>${esc(u.work)}</b></div>`:'',u.education?`<div>🎓 Pendidikan <b>${esc(u.education)}</b></div>`:'',u.website?`<div>🔗 <a href="${esc(u.website)}" target="_blank" rel="noopener noreferrer">${esc(u.website)}</a></div>`:''].filter(Boolean).join('');
      const composer=u.id===currentUser.id?`<section class="profile-composer"><div class="profile-composer-top">${avatarHTML(currentUser)}<button class="fake" id="profileComposerInput">Apa yang Anda pikirkan sekarang?</button></div><div class="profile-composer-actions"><button id="profileLiveBtn">🔴 Video siaran langsung</button><button id="profilePhotoBtn">🖼️ Foto/video</button><button id="profileReelBtn">🎬 Reel</button></div></section>`:(activeLive?`<section class="profile-live-card"><b class="profile-live-badge">🔴 Sedang Live</b><p>${esc(activeLive.title||'Siaran langsung')}</p><button class="primary" id="watchProfileLiveBtn">Tonton Live</button></section>`:'');
      body.innerHTML=`<div class="profile-home-grid"><aside class="profile-sidebar"><section class="profile-details-card"><h2>Detail pribadi</h2>${details||'<p class="profile-window-empty">Belum ada informasi profil yang ditambahkan.</p>'}<div class="profile-detail-more">Lihat detail pribadi lainnya</div></section><section class="profile-side-card"><h3>Teman</h3><p class="muted">${Number(u.followers_count)||0} pengikut • ${Number(u.following_count)||0} mengikuti</p><button class="secondary" id="profileFriendsBtn">Lihat semua</button></section></aside><section class="profile-feed-column">${composer}<section class="profile-posts-section"><div class="profile-posts-title"><h2>${tab==='photo'?'Foto':tab==='video'?'Reels':'Postingan'}</h2><button class="secondary">⚙️ Kelola postingan</button></div>${posts.map(postCard).join('')||'<div class="profile-window-empty">Belum ada postingan publik.</div>'}</section></section></div>`;
      attachPostEvents();
      $('#profileComposerInput')?.addEventListener('click',()=>createPost('text'));
      $('#profilePhotoBtn')?.addEventListener('click',()=>createPost('image'));
      $('#profileReelBtn')?.addEventListener('click',()=>createPost('video'));
      $('#profileLiveBtn')?.addEventListener('click',startLive);$('#watchProfileLiveBtn')?.addEventListener('click',()=>watchLive(activeLive.id));
      $('#profileFriendsBtn')?.addEventListener('click',()=>loadProfileWindowTab(id,'friends'));
      return;
    }
    if(tab==='about'){
      const u=profileWindowUser; const details=[u.bio?`<div class="profile-bio">${esc(u.bio)}</div>`:'',u.city?`<div>📍 Tinggal di <b>${esc(u.city)}</b></div>`:'',u.work?`<div>💼 Bekerja sebagai <b>${esc(u.work)}</b></div>`:'',u.education?`<div>🎓 Pendidikan <b>${esc(u.education)}</b></div>`:'',u.website?`<div>🔗 <a href="${esc(u.website)}" target="_blank" rel="noopener noreferrer">${esc(u.website)}</a></div>`:''].filter(Boolean).join(''); body.innerHTML=`<section class="profile-about-section"><h2>ℹ️ Tentang ${esc(u.display_name)}</h2>${details||'<p class="profile-window-empty">Belum ada informasi profil yang ditambahkan.</p>'}<div class="profile-info-grid"><div><small>Bergabung</small><b>${u.created_at?new Date(u.created_at).toLocaleDateString('id-ID',{day:'numeric',month:'long',year:'numeric'}):'-'}</b></div><div><small>Post</small><b>${Number(u.posts_count)||0}</b></div><div><small>Pengikut</small><b>${Number(u.followers_count)||0}</b></div><div><small>Mengikuti</small><b>${Number(u.following_count)||0}</b></div></div></section>`; return;
    }
    if(['friends','following','followers'].includes(tab)){
      const d=await api(`/users/${id}/${tab}`); const title=tab==='friends'?'👥 Daftar Teman':tab==='following'?'➡️ Daftar Mengikuti':'⬅️ Daftar Pengikut'; const empty=tab==='friends'?'Belum ada teman.':tab==='following'?'Belum mengikuti akun lain.':'Belum ada pengikut.'; body.innerHTML=`<section class="profile-list-section"><h2>${title}</h2><p class="muted">${(d.users||[]).length} akun</p><div class="profile-list">${profileListHTML(d.users,empty)}</div></section>`; $$('.profile-window-body .clickable-user').forEach(b=>b.onclick=()=>showProfile(Number(b.dataset.profileId))); return;
    }
    const type=tab==='photo-albums'?'photo':'video'; const d=await api(`/users/${id}/albums?type=${type}`); const title=type==='photo'?'🖼️ Album Foto':'🎞️ Album Video';
    body.innerHTML=`<section class="profile-albums-section"><h2>${title}</h2><p class="muted">${(d.albums||[]).length} album</p><div class="profile-album-grid">${(d.albums||[]).map(a=>`<article class="profile-album-card" data-album-id="${a.id}" data-album-type="${type}"><div class="profile-album-icon">${type==='photo'?'📷':'🎬'}</div><div><h3>${esc(a.name)}</h3><small>${Number(a.media_count)||0} media</small></div></article>`).join('')||`<div class="profile-window-empty">Belum ada album ${type==='photo'?'foto':'video'}.</div>`}</div></section>`;
    $$('.profile-album-card').forEach(c=>c.onclick=()=>openPublicProfileAlbum(id,Number(c.dataset.albumId),type));
  }catch(e){body.innerHTML=`<div class="profile-window-empty">${esc(e.message)}</div>`}
}
async function openPublicProfileAlbum(userId,albumId,type){
  const body=$('#profileWindowBody'); if(!body)return; body.innerHTML='<div class="loading">Memuat album...</div>';
  try{const all=await api(`/users/${userId}/albums?type=${type}`);const a=(all.albums||[]).find(x=>String(x.id)===String(albumId));if(!a)throw new Error('Album tidak ditemukan.');const d=await api(`/users/${userId}/albums/${albumId}/media`);body.innerHTML=`<section class="profile-public-album"><button class="page-back" id="publicAlbumBack">← Kembali ke album</button><h2>${type==='photo'?'🖼️':'🎞️'} ${esc(a.name)}</h2><p class="muted">${Number(a.media_count)||0} media</p><div class="album-media-grid">${(d.media||[]).map(m=>m.media_type==='video'?`<video src="${esc(m.media_url)}" controls preload="metadata" class="album-media-video"></video>`:`<img src="${esc(m.media_url)}" class="album-media-photo" alt="Foto album" loading="lazy">`).join('')||'<div class="profile-window-empty">Album ini belum memiliki media.</div>'}</div></section>`;$('#publicAlbumBack').onclick=()=>loadProfileWindowTab(userId,type==='photo'?'photo-albums':'video-albums');attachMediaViewer()}catch(e){body.innerHTML=`<div class="profile-window-empty">${esc(e.message)}</div>`}
}
function personRow(u,mode=''){return `<div class="friend-card">${avatarHTML(u)}<div class="friend-info"><b class="clickable-user" data-profile-id="${u.id}">${esc(u.display_name)}</b><small>@${esc(u.username)}</small>${mode==='friends'?'<span>👥 Saling mengikuti</span>':''}</div>${mode==='discover'?`<button class="follow-btn ${followClass(u)}" data-user-id="${u.id}" data-following="${u.is_following?'1':'0'}">${followLabel(u)}</button>`:''}</div>`}
async function loadFriends(tab=currentFriendTab,q=''){if(!requireLogin())return;currentFriendTab=tab;$$('.friends-tab').forEach(x=>x.classList.toggle('active',x.dataset.friendTab===tab));const list=$('#friendsList');list.innerHTML='<div class="loading">Memuat daftar...</div>';try{let d;if(tab==='discover'){d=await api('/users/search?q='+encodeURIComponent(q));list.innerHTML=(d.users||[]).map(u=>personRow(u,'discover')).join('')||'<p class="muted">Pengguna tidak ditemukan.</p>'}else{d=await api(`/users/${currentUser.id}/${tab}`);list.innerHTML=(d.users||[]).map(u=>personRow(u,tab)).join('')||`<p class="muted">Belum ada ${tab==='friends'?'teman':tab==='following'?'akun yang kamu ikuti':'pengikut'}.</p>`}$$('#friendsList .clickable-user').forEach(b=>b.onclick=()=>showProfile(Number(b.dataset.profileId)));$$('#friendsList .follow-btn').forEach(b=>b.onclick=()=>toggleFollow(b.dataset.userId,b))}catch(e){list.innerHTML=`<p class="muted">${esc(e.message)}</p>`}}
async function showFriends(tab='friends'){if(!requireLogin())return;hideMainPanels();$('#friendsPanel').classList.remove('hidden');$('#friendSearch').value='';$('#friendSearch').classList.toggle('hidden',tab!=='discover');await loadFriends(tab)}
async function showComments(id){selectedPost=id;open('commentModal');$('#commentContent').innerHTML='<div class="loading">Memuat komentar...</div>';try{const d=await api(`/posts/${id}/comments`);$('#commentContent').innerHTML=(d.comments||[]).map(c=>`<div class="comment"><b>${esc(c.display_name||c.username)}</b><p>${esc(c.body)}</p><small>${new Date(c.created_at).toLocaleString('id-ID')}</small></div>`).join('')||'<p class="muted">Belum ada komentar.</p>'}catch(e){$('#commentContent').innerHTML=`<p>${esc(e.message)}</p>`}}
let composeFriends=[];
async function loadComposeFriends(){try{const d=await api(`/users/${currentUser.id}/friends`);composeFriends=d.users||[];const box=$('#selectedFriendsList');if(!box)return;box.innerHTML=composeFriends.map(u=>`<label class="selected-friend"><input type="checkbox" value="${u.id}">${avatarHTML(u)}<span><b>${esc(u.display_name)}</b><small>@${esc(u.username)}</small></span></label>`).join('')||'<span class="muted">Kamu belum memiliki teman.</span>';}catch(e){$('#selectedFriendsList').innerHTML=`<span class="muted">${esc(e.message)}</span>`}}
function updateAudienceUI(){const v=$('#postVisibility')?.value||'public';$('#selectedFriendsWrap')?.classList.toggle('hidden',v!=='selected');if(v==='selected'&&currentUser&&!composeFriends.length)loadComposeFriends()}
async function createPost(kind='text'){
  if(!requireLogin())return;
  selectedMedia=[];
  const cap=$('#captionInput'),preview=$('#mediaPreview'),title=$('#composeTitle'),input=$('#mediaInput');
  if(cap)cap.value='';
  if(preview)preview.innerHTML='';
  if($('#postVisibility'))$('#postVisibility').value='public';
  $('#selectedFriendsWrap')?.classList.add('hidden');
  if(title)title.textContent=kind==='text'?'Buat postingan':kind==='image'?'Tambah foto':'Tambah video';
  if(input){input.value='';input.accept=kind==='image'?'image/*':kind==='video'?'video/*':'image/*,video/*';input.multiple=kind!=='video';input.dataset.postKind=kind;}
  open('composeModal');
  if(kind!=='text')requestAnimationFrame(()=>input?.click());
}
async function uploadMedia(file){
  const fd=new FormData();fd.append('media',file);
  const h={};if(token())h.Authorization=`Bearer ${token()}`;
  const r=await fetch(API_BASE+'/upload',{method:'POST',headers:h,body:fd});
  const d=await r.json().catch(()=>({}));
  if(!r.ok)throw new Error(d.error||'Upload gagal.');
  return d;
}
async function uploadMediaMultiple(files){
  const fd=new FormData();files.forEach(f=>fd.append('media',f));
  const h={};if(token())h.Authorization=`Bearer ${token()}`;
  const r=await fetch(API_BASE+'/upload-multiple',{method:'POST',headers:h,body:fd});
  const d=await r.json().catch(()=>({}));
  if(!r.ok)throw new Error(d.error||'Upload beberapa media gagal.');
  return d.files||[];
}
async function publishPost(e){
  e.preventDefault();
  if(!requireLogin())return;
  const btn=$('#composeForm button.primary'),caption=$('#captionInput')?.value.trim()||'';
  if(!caption&&!selectedMedia.length)return status('Tulis teks atau pilih foto/video terlebih dahulu.',true);
  if(btn)btn.disabled=true;
  try{
    const visibility=$('#postVisibility')?.value||'public';
    const audience_user_ids=visibility==='selected'?$$('#selectedFriendsList input[type=checkbox]:checked').map(x=>x.value):[];
    if(visibility==='selected'&&!audience_user_ids.length){if(btn)btn.disabled=false;return status('Pilih minimal satu teman.',true)}
    let uploaded=[];
    if(selectedMedia.length){
      status(`Mengunggah ${selectedMedia.length} media...`);
      uploaded=await uploadMediaMultiple(selectedMedia);
    }
    if(!uploaded.length){
      await api('/posts',{method:'POST',body:JSON.stringify({caption,media_url:null,media_type:null,visibility,audience_user_ids})});
    }else{
      for(let i=0;i<uploaded.length;i++){
        await api('/posts',{method:'POST',body:JSON.stringify({caption:i===0?caption:'',media_url:uploaded[i].url,media_type:uploaded[i].media_type,visibility,audience_user_ids})});
      }
    }
    close('composeModal');
    selectedMedia=[];
    const input=$('#mediaInput');if(input)input.value='';
    status(uploaded.length>1?`${uploaded.length} foto/video berhasil dipublikasikan.`:'Postingan berhasil dipublikasikan.');
    await loadFeed();
  }catch(err){status(err.message,true)}finally{if(btn)btn.disabled=false}
}
function previewSelectedMedia(files){
  const box=$('#mediaPreview');if(!box)return;
  if(!files||!files.length){box.innerHTML='';return}
  box.innerHTML=files.map((file,i)=>{
    const url=URL.createObjectURL(file);
    return file.type.startsWith('video/')
      ? `<div class="media-preview-item"><video src="${esc(url)}" controls playsinline></video><small>${i+1}. ${esc(file.name)}</small></div>`
      : `<div class="media-preview-item"><img src="${esc(url)}" alt="Pratinjau media ${i+1}"><small>${i+1}. ${esc(file.name)}</small></div>`;
  }).join('');
}
let avatarCrop={file:null,img:null,scale:1,x:0,y:0,drag:false,sx:0,sy:0,ox:0,oy:0};
function positionAvatarCrop(){
  const stage=$('#avatarCropStage'),img=$('#avatarCropImage'); if(!stage||!img||!avatarCrop.img)return;
  const size=stage.clientWidth, iw=avatarCrop.img.naturalWidth, ih=avatarCrop.img.naturalHeight;
  const base=Math.max(size/iw,size/ih), sc=base*avatarCrop.scale;
  const w=iw*sc,h=ih*sc;
  const maxX=Math.max(0,(w-size)/2),maxY=Math.max(0,(h-size)/2);
  avatarCrop.x=Math.max(-maxX,Math.min(maxX,avatarCrop.x)); avatarCrop.y=Math.max(-maxY,Math.min(maxY,avatarCrop.y));
  img.style.width=w+'px'; img.style.height=h+'px'; img.style.transform=`translate(${avatarCrop.x}px,${avatarCrop.y}px)`;
}
function resetAvatarCrop(){avatarCrop.scale=1;avatarCrop.x=0;avatarCrop.y=0;$('#avatarCropZoom').value='1';positionAvatarCrop()}
function closeAvatarCrop(){close('avatarCropModal');avatarCrop.file=null;avatarCrop.img=null;}
function openAvatarCrop(file){
  if(!file||!file.type.startsWith('image/'))return status('Foto profil harus berupa gambar.',true);
  if(file.size>10*1024*1024)return status('Foto profil maksimal 10 MB.',true);
  const img=new Image(); img.onload=()=>{avatarCrop.file=file;avatarCrop.img=img;avatarCrop.scale=1;avatarCrop.x=0;avatarCrop.y=0;$('#avatarCropImage').src=img.src;$('#avatarCropZoom').value='1';open('avatarCropModal');requestAnimationFrame(positionAvatarCrop)};img.onerror=()=>status('Foto tidak dapat dibaca.',true);img.src=URL.createObjectURL(file);
}
function cropAvatarToBlob(){
  return new Promise((resolve,reject)=>{
    const stage=$('#avatarCropStage'),img=avatarCrop.img;if(!stage||!img)return reject(new Error('Pratinjau foto belum siap.'));
    const size=800, out=document.createElement('canvas');out.width=size;out.height=size;const ctx=out.getContext('2d');
    const stageSize=stage.clientWidth, base=Math.max(stageSize/img.naturalWidth,stageSize/img.naturalHeight),sc=base*avatarCrop.scale;
    const drawW=img.naturalWidth*sc,drawH=img.naturalHeight*sc;
    const dx=(stageSize-drawW)/2+avatarCrop.x,dy=(stageSize-drawH)/2+avatarCrop.y;
    const factor=size/stageSize;ctx.drawImage(img,dx*factor,dy*factor,drawW*factor,drawH*factor);
    out.toBlob(b=>b?resolve(b):reject(new Error('Gagal menyiapkan foto profil.')),'image/jpeg',.92);
  });
}
async function uploadAvatar(file){if(!requireLogin())return;openAvatarCrop(file)}
async function saveCroppedAvatar(){
  if(!avatarCrop.file||!avatarCrop.img)return;
  const btn=$('#avatarCropSave');try{btn.disabled=true;$('#avatarCropMessage').textContent='Menyiapkan foto...';const blob=await cropAvatarToBlob();const fd=new FormData();fd.append('avatar',blob,'profile-crop.jpg');const h={};if(token())h.Authorization=`Bearer ${token()}`;$('#avatarCropMessage').textContent='Mengunggah foto profil...';const r=await fetch(API_BASE+'/me/avatar',{method:'POST',headers:h,body:fd});const d=await r.json().catch(()=>({}));if(!r.ok)throw new Error(d.error||'Foto profil gagal diperbarui.');currentUser=(await api('/me')).user;updateUserUI();renderSettingsAvatar();closeAvatarCrop();status('Foto profil berhasil diperbarui.');}catch(e){$('#avatarCropMessage').textContent=e.message;status(e.message,true)}finally{btn.disabled=false}
}

async function loadMessageUsers(q=''){if(!requireLogin())return;const list=$('#messageUserList');list.innerHTML='<div class="loading">Memuat riwayat pesan...</div>';try{const d=await api('/messages/users?q='+encodeURIComponent(q));list.innerHTML=(d.users||[]).map(u=>`<div class="message-user"><button class="message-user-main" data-user-id="${u.id}">${avatarHTML(u)}<span><b>${esc(u.display_name)}</b><small>@${esc(u.username)}</small></span></button><span class="message-user-tools"><button class="view-profile-btn" data-user-id="${u.id}">Profil</button></span></div>`).join('')||'<p class="muted">Belum ada akun yang pernah diajak chat.</p>';$$('#messageUserList .message-user-main').forEach(b=>b.onclick=()=>selectChatUser(Number(b.dataset.userId)));$$('#messageUserList .view-profile-btn').forEach(b=>b.onclick=()=>showProfile(Number(b.dataset.userId)))}catch(e){list.innerHTML=`<p class="muted">${esc(e.message)}</p>`}}
async function selectChatUser(id){if(!currentUser)return;try{const d=await api('/messages/'+id);selectedChatUser=d.user;$('#chatHeader').innerHTML=`<div class="chat-header-row">${avatarHTML(d.user)}<div><b>${esc(d.user.display_name)}</b><small>@${esc(d.user.username)} · Pesan pribadi</small></div><button class="chat-profile-btn" id="chatProfileBtn">👤 Profil</button></div>`;$('#chatProfileBtn').onclick=()=>showProfile(d.user.id);$('#messageInput').disabled=false;$('#messageForm button').disabled=false;renderChat(d.messages||[]);startChatPolling()}catch(e){status(e.message,true)}}
function renderChat(messages){const box=$('#chatMessages');box.innerHTML=(messages||[]).map(m=>`<div class="chat-bubble ${String(m.sender_id)===String(currentUser.id)?'mine':'theirs'}"><p>${esc(m.body)}</p><small>${new Date(m.created_at).toLocaleString('id-ID',{dateStyle:'short',timeStyle:'short'})}</small></div>`).join('')||'<p class="muted">Belum ada pesan. Kirim pesan pertama.</p>';box.scrollTop=box.scrollHeight}
async function refreshChat(){if(!selectedChatUser||!currentUser)return;try{const d=await api('/messages/'+selectedChatUser.id);renderChat(d.messages||[])}catch{}}
function startChatPolling(){if(chatPoll)clearInterval(chatPoll);chatPoll=setInterval(()=>{if(!$('#messagesPage')?.classList.contains('hidden'))refreshChat()},5000)}
function stopChatPolling(){if(chatPoll){clearInterval(chatPoll);chatPoll=null}}
function openMessages(){if(!requireLogin())return;hideMainPanels();$('.hero')?.classList.add('hidden');$('.composer')?.classList.add('hidden');$('.grid')?.classList.add('hidden');const page=$('#messagesPage');page.classList.remove('hidden');page.innerHTML=`<button class="page-back" id="messagesBack">← Kembali</button><div class="message-card"><h2>💬 Pesan pribadi</h2><div class="message-layout"><section class="message-users"><input id="messageUserSearch" placeholder="Cari di riwayat pesan..." autocomplete="off"><div id="messageUserList" class="message-user-list"></div></section><section class="chat-panel"><div id="chatHeader" class="chat-header"><b>Pilih pengguna</b><small>Pesan pribadi hanya terlihat oleh pengirim dan penerima.</small></div><div id="chatMessages" class="chat-messages"><p class="muted">Pilih pengguna untuk membuka percakapan.</p></div><form id="messageForm" class="chat-form"><input id="messageInput" maxlength="5000" placeholder="Tulis pesan pribadi..." autocomplete="off" disabled required><button class="primary" disabled>Kirim</button></form></section></div></div>`;selectedChatUser=null;stopChatPolling();$('#messagesBack').onclick=()=>showView('home');$('#messageUserSearch').addEventListener('input',e=>loadMessageUsers(e.target.value.trim()));$('#messageForm').onsubmit=async e=>{e.preventDefault();if(!selectedChatUser||!requireLogin())return;const body=$('#messageInput').value.trim();if(!body)return;const btn=$('#messageForm button');btn.disabled=true;try{await api('/messages',{method:'POST',body:JSON.stringify({receiver_id:selectedChatUser.id,body})});$('#messageInput').value='';await refreshChat()}catch(err){status(err.message,true)}finally{btn.disabled=false;$('#messageInput').focus()}};loadMessageUsers()}
function renderSettingsAvatar(){const box=$('#settingsAvatarPreview');if(box&&currentUser){box.innerHTML=avatarHTML(currentUser,'settings-avatar');attachMediaViewer()}}
async function showSettings(){if(!requireLogin())return;open('settingsModal');try{const u=(await api('/me')).user;currentUser=u;updateUserUI();renderSettingsAvatar();$('#settingsName').value=u.display_name||'';$('#settingsUsername').value=u.username||'';$('#settingsBio').value=u.bio||'';$('#settingsCity').value=u.city||'';$('#settingsWork').value=u.work||'';$('#settingsEducation').value=u.education||'';$('#settingsWebsite').value=u.website||'';$('#settingsMessage').textContent='Foto profil dan profil publik dikelola terpisah.'}catch(e){$('#settingsMessage').textContent=e.message}}
async function startLive(){if(!requireLogin())return;open('liveModal');$('#liveSetup')?.classList.remove('hidden');$('#liveStage')?.classList.add('hidden');$('#liveMessage').textContent='Meminta izin kamera dan mikrofon...';try{const media=await navigator.mediaDevices.getUserMedia({video:true,audio:true});liveState.stream=media;$('#liveVideo').srcObject=media;const title=$('#liveTitle').value.trim()||'Siaran langsung RAVIXO';const d=await api('/live',{method:'POST',body:JSON.stringify({title})});liveState.streamId=String(d.stream.id);liveState.role='host';liveState.peers=new Map();const proto=location.protocol==='https:'?'wss':'ws';liveState.ws=new WebSocket(`${proto}://${location.host}/live?token=${encodeURIComponent(token())}`);liveState.ws.onopen=()=>liveState.ws.send(JSON.stringify({type:'join',streamId:liveState.streamId,role:'host'}));liveState.ws.onmessage=async ev=>{const m=JSON.parse(ev.data);if(m.type==='viewer-joined'){const pc=createLivePeer(m.viewerId,true);const offer=await pc.createOffer();await pc.setLocalDescription(offer);sendLive({type:'offer',to:m.viewerId,offer});}else if(m.type==='answer'){const pc=liveState.peers.get(String(m.from));if(pc)await pc.setRemoteDescription(m.answer)}else if(m.type==='candidate'){const pc=liveState.peers.get(String(m.from));if(pc&&m.candidate)try{await pc.addIceCandidate(m.candidate)}catch{}}};liveState.ws.onerror=()=>status('Koneksi live gagal.',true);$('#liveSetup').classList.add('hidden');$('#liveStage').classList.remove('hidden');$('#liveStatus').textContent='🔴 LIVE';$('#liveViewerCount').textContent='Menunggu penonton...';}catch(e){liveState.stream?.getTracks().forEach(t=>t.stop());liveState.stream=null;$('#liveMessage').textContent=e.message||'Kamera/mikrofon tidak dapat digunakan.'}}
function sendLive(m){if(liveState.ws?.readyState===WebSocket.OPEN)liveState.ws.send(JSON.stringify(m))}
function createLivePeer(peerId,isHost){const pc=new RTCPeerConnection({iceServers:[{urls:'stun:stun.l.google.com:19302'}]});liveState.peers.set(String(peerId),pc);if(isHost)liveState.stream?.getTracks().forEach(t=>pc.addTrack(t,liveState.stream));pc.onicecandidate=e=>{if(e.candidate)sendLive({type:'candidate',to:String(peerId),candidate:e.candidate});};return pc}
async function watchLive(streamId){if(!requireLogin())return;open('liveModal');$('#liveSetup').classList.add('hidden');$('#liveStage').classList.remove('hidden');$('#liveStatus').textContent='🔴 LIVE';$('#liveViewerCount').textContent='Menonton';liveState.role='viewer';liveState.streamId=String(streamId);liveState.peers=new Map();const proto=location.protocol==='https:'?'wss':'ws';liveState.ws=new WebSocket(`${proto}://${location.host}/live?token=${encodeURIComponent(token())}`);liveState.ws.onopen=()=>liveState.ws.send(JSON.stringify({type:'join',streamId:liveState.streamId,role:'viewer'}));liveState.ws.onmessage=async ev=>{const m=JSON.parse(ev.data);if(m.type==='offer'){const pc=createLivePeer(String(m.from),false);pc.ontrack=e=>{if(e.streams[0])$('#liveVideo').srcObject=e.streams[0]};await pc.setRemoteDescription(m.offer);const answer=await pc.createAnswer();await pc.setLocalDescription(answer);sendLive({type:'answer',to:String(m.from),answer});}else if(m.type==='candidate'){const pc=liveState.peers.get(String(m.from));if(pc&&m.candidate)try{await pc.addIceCandidate(m.candidate)}catch{}}};liveState.ws.onerror=()=>status('Tidak dapat terhubung ke live.',true)}
async function endLive(){try{if(liveState.streamId&&liveState.role==='host')await api(`/live/${liveState.streamId}/end`,{method:'POST'});}catch{};liveState.stream?.getTracks().forEach(t=>t.stop());liveState.peers?.forEach(pc=>pc.close());liveState.ws?.close();liveState={stream:null,ws:null,streamId:null,role:null,peers:new Map()};close('liveModal');status('Siaran langsung diakhiri.');}

async function loadCreator(){if(!requireLogin())return;open('creatorModal');$('#creatorContent').innerHTML='Memuat...';try{const c=(await api('/creator/dashboard')).creator;if(!c)return $('#creatorContent').innerHTML='<p>Akun kreator belum tersedia.</p>';$('#creatorContent').innerHTML=`<div class="creator-stat"><small>Saldo</small><strong>${money(c.balance)}</strong></div><div class="creator-stat"><small>Menunggu</small><strong>${money(c.pending_balance)}</strong></div><div class="creator-stat"><small>Total</small><strong>${money(c.lifetime_earnings)}</strong></div><label>Jumlah pencairan<input id="payoutAmount" type="number" min="1" step="1000" placeholder="Rp"></label><button id="payoutBtn" class="primary">Ajukan Pencairan</button>`;$('#payoutBtn').onclick=async()=>{const amount=Number($('#payoutAmount').value);if(!Number.isFinite(amount)||amount<=0)return status('Jumlah pencairan tidak valid.',true);try{await api('/creator/payouts',{method:'POST',body:JSON.stringify({amount})});status('Permintaan pencairan dibuat.');close('creatorModal');await loadEarnings()}catch(e){status(e.message,true)}}}catch(e){$('#creatorContent').innerHTML=`<p>${esc(e.message)}</p>`}}
async function loadEarnings(){if(!currentUser)return;try{const c=(await api('/creator/dashboard')).creator;if(c){$('#earningsBalance').textContent=money(c.balance);$('#earningsNote').textContent=`Total penghasilan: ${money(c.lifetime_earnings)}`;const target=Math.max(Number(c.lifetime_earnings),1);$('#earningsBar').style.width=Math.min(100,Number(c.balance)/target*100)+'%'}}catch{}}
async function updateNotificationBadge(){if(!currentUser)return;try{const d=await api('/notifications');const badge=$('#notificationBadge');const n=Number(d.unread_count||0);badge.textContent=n>99?'99+':String(n);badge.classList.toggle('hidden',n===0)}catch{}}
async function loadNotifications(){if(!requireLogin())return;open('notificationModal');const b=$('#notificationContent');try{const d=await api('/notifications');b.innerHTML=(d.notifications||[]).map(n=>`<div class="notification-item"><b>${esc(n.type||'Notifikasi')}</b><p>${esc(n.message||'Aktivitas baru')}</p><small>${new Date(n.created_at).toLocaleString('id-ID')}</small></div>`).join('')||'<p>Belum ada notifikasi.</p>';await api('/notifications/read',{method:'POST'});$('#notificationBadge').classList.add('hidden')}catch(e){b.innerHTML=`<p>${esc(e.message)}</p>`}}
async function createAlbum(type){if(!requireLogin())return;const name=prompt(`Nama album ${type==='photo'?'foto':'video'}:`);if(name===null)return;const n=name.trim();if(!n)return status('Nama album tidak boleh kosong.',true);try{await api('/albums',{method:'POST',body:JSON.stringify({name:n,album_type:type})});status('Album berhasil dibuat.');await loadAlbumsPage(type)}catch(e){status(e.message,true)}}
async function loadAlbumsPage(type){if(!requireLogin())return;currentAlbumType=type;hideMainPanels();$('.hero')?.classList.add('hidden');$('.composer')?.classList.add('hidden');$('.grid')?.classList.add('hidden');const page=$('#albumPage');page.classList.remove('hidden');page.innerHTML=`<div class="album-header"><div><button class="page-back" id="albumBack">← Kembali</button><h2>${type==='photo'?'🖼️ Album Foto':'🎞️ Album Video'}</h2><p class="muted">Buat album, ganti nama album, dan unggah ${type==='photo'?'foto':'video'} ke album pilihanmu.</p></div><button class="primary album-create-btn" id="createAlbumBtn">＋ Buat Album</button></div><div id="albumList" class="album-grid"><div class="loading">Memuat album...</div></div>`;$('#albumBack').onclick=()=>showView('home');$('#createAlbumBtn').onclick=()=>createAlbum(type);const d=await api('/albums?type='+type);const list=$('#albumList');list.innerHTML=(d.albums||[]).map(a=>`<article class="album-card" data-album-id="${a.id}"><div class="album-icon">${type==='photo'?'📷':'🎬'}</div><div class="album-card-main"><h3>${esc(a.name)}</h3><small>${Number(a.media_count)||0} media</small></div><div class="album-card-actions"><button class="secondary album-open-btn" data-id="${a.id}">Buka</button><button class="secondary album-rename-btn" data-id="${a.id}" data-name="${esc(a.name)}">✏️ Rename</button></div></article>`).join('')||'<div class="panel empty">Belum ada album. Buat album pertamamu.</div>';$$('.album-open-btn').forEach(b=>b.onclick=()=>openAlbum(Number(b.dataset.id),type));$$('.album-rename-btn').forEach(b=>b.onclick=()=>renameAlbum(Number(b.dataset.id),b.dataset.name,type))}
async function renameAlbum(id,oldName,type){const name=prompt('Nama album baru:',oldName);if(name===null||!name.trim())return;try{await api(`/albums/${id}`,{method:'PUT',body:JSON.stringify({name:name.trim()})});status('Nama album berhasil diubah.');await loadAlbumsPage(type)}catch(e){status(e.message,true)}}
async function openAlbum(id,type){if(!requireLogin())return;const page=$('#albumPage');page.innerHTML=`<button class="page-back" id="albumDetailBack">← Kembali ke Album</button><div id="albumDetail"><div class="loading">Memuat album...</div></div>`;$('#albumDetailBack').onclick=()=>loadAlbumsPage(type);try{const all=await api('/albums?type='+type);const a=(all.albums||[]).find(x=>String(x.id)===String(id));if(!a)throw new Error('Album tidak ditemukan.');const d=await api(`/albums/${id}/media`);$('#albumDetail').innerHTML=`<div class="album-detail-head"><div><h2>${type==='photo'?'🖼️':'🎞️'} ${esc(a.name)}</h2><p class="muted">${Number(a.media_count)||0} media</p></div><div><button class="secondary" id="renameAlbumDetail">✏️ Rename</button><button class="primary album-upload-btn" id="uploadAlbumBtn">＋ Unggah ${type==='photo'?'Foto':'Video'}</button><input id="albumMediaInput" type="file" accept="${type==='photo'?'image/*':'video/*'}" hidden></div></div><div class="album-media-grid">${(d.posts||[]).map(p=>p.media_type==='video'?`<video src="${esc(p.media_url)}" controls preload="metadata" class="album-media-video"></video>`:`<img src="${esc(p.media_url)}" class="album-media-photo" alt="Foto album" loading="lazy">`).join('')||'<div class="panel empty">Album ini belum memiliki media.</div>'}</div>`;$('#renameAlbumDetail').onclick=()=>renameAlbum(id,a.name,type);$('#uploadAlbumBtn').onclick=()=>$('#albumMediaInput').click();$('#albumMediaInput').onchange=async e=>{const files=[...(e.target.files||[])];if(!files.length)return;if(files.length>20)return status('Maksimal 20 file sekaligus ke album.',true);if(files.some(f=>f.size>100*1024*1024))return status('Setiap file maksimal 100 MB.',true);try{status(`Mengunggah ${files.length} media ke album...`);for(const f of files){const fd=new FormData();fd.append('media',f);const h={};if(token())h.Authorization=`Bearer ${token()}`;const r=await fetch(API_BASE+`/albums/${id}/media`,{method:'POST',headers:h,body:fd});const x=await r.json().catch(()=>({}));if(!r.ok)throw new Error(x.error||'Upload album gagal.')}status(`${files.length} media berhasil ditambahkan ke album.`);await openAlbum(id,type)}catch(e){status(e.message,true)}finally{e.target.value=''}}}catch(e){$('#albumDetail').innerHTML=`<div class="panel empty">${esc(e.message)}</div>`}}
async function finishGoogleLogin(d,successText='Berhasil masuk dengan Google.'){localStorage.setItem(TOKEN_KEY,d.token);currentUser=(await api('/me')).user;updateUserUI();startNotificationPolling();$('#authModal')?.classList.remove('auth-required');close('authModal');$('#authMessage').textContent='';$('#googleCompleteWrap')?.classList.add('hidden');$('#authForm')?.classList.remove('hidden');status(successText);showView('home');await loadFeed()}
function renderGoogleButton(){
  const box=$('#googleSignIn');
  if(!box||!googleInitialized||!window.google?.accounts?.id)return;
  box.innerHTML='';
  window.google.accounts.id.renderButton(box,{theme:'outline',size:'large',text:authMode==='register'?'signup_with':'signin_with',shape:'rectangular',logo_alignment:'left',width:360});
}
async function handleGoogleCredential(response){
  if(!response?.credential)return;
  try{
    const d=await api('/auth/google',{method:'POST',body:JSON.stringify({credential:response.credential})});
    googlePendingCredential='';
    await finishGoogleLogin(d);
  }catch(e){
    try{
      const raw=String(e.message||'');
      if(raw.toLowerCase().includes('masukkan nomor hp')||raw.toLowerCase().includes('nomor hp satu kali')){
        googlePendingCredential=response.credential;
        const d=await fetch(API_BASE+'/auth/google',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({credential:response.credential})}).then(async r=>{const x=await r.json().catch(()=>({}));return {ok:r.ok,status:r.status,data:x}});
        if(d.data?.needs_phone){
          setAuthMode('register');
          $('#authEmail').value=d.data.email||'';
          $('#displayName').value=d.data.display_name||'';
          $('#username').value=d.data.username||'';
          $('#authForm')?.classList.add('hidden');
          $('#googleSignIn')?.classList.add('hidden');
          $('#googleCompleteWrap')?.classList.remove('hidden');
          $('#authMessage').textContent='';
          status('Masukkan nomor HP satu kali untuk menyelesaikan pendaftaran Google.',true);
          return;
        }
      }
      $('#authMessage').textContent=e.message;
    }catch(err){$('#authMessage').textContent=err.message||e.message}
  }
}
async function initGoogleAuth(){
  try{
    const r=await fetch(API_BASE+'/config');const cfg=await r.json().catch(()=>({}));googleClientId=cfg.google_client_id||'';
    if(!googleClientId)return;
    let tries=0;
    const boot=()=>{
      if(window.google?.accounts?.id){
        window.google.accounts.id.initialize({client_id:googleClientId,callback:handleGoogleCredential});
        googleInitialized=true;renderGoogleButton();
      }else if(tries++<100)setTimeout(boot,100);
    };
    boot();
  }catch(e){console.warn('Google Sign-In tidak tersedia:',e)}
}
async function auth(e){
  e.preventDefault();
  const password=$('#authPassword').value;
  if(!password)return $('#authMessage').textContent='Password wajib diisi.';
  let body;
  if(authMode==='login'){
    const identifier=$('#authIdentifier').value.trim();
    if(!identifier)return $('#authMessage').textContent='Masukkan email atau nomor HP.';
    body={identifier,password};
  }else{
    const email=$('#authEmail').value.trim(),phone=$('#authPhone').value.trim();
    if(!email||!phone||!password)return $('#authMessage').textContent='Email, nomor HP dan password wajib diisi.';
    if(!$('#displayName').value.trim()||!$('#username').value.trim())return $('#authMessage').textContent='Nama dan username wajib diisi.';
    body={email,phone,password,display_name:$('#displayName').value.trim(),username:$('#username').value.trim()};
  }
  try{
    const d=await api('/auth/'+authMode,{method:'POST',body:JSON.stringify(body)});
    localStorage.setItem(TOKEN_KEY,d.token);currentUser=(await api('/me')).user;updateUserUI();startNotificationPolling();
    $('#authModal')?.classList.remove('auth-required');close('authModal');$('#authMessage').textContent='';
    status(authMode==='login'?'Berhasil masuk.':'Akun berhasil dibuat.');showView('home');await loadFeed();
  }catch(e){$('#authMessage').textContent=e.message}
}
function setAuthMode(m){
  authMode=m;$('#loginTab')?.classList.toggle('selected',m==='login');$('#registerTab')?.classList.toggle('selected',m==='register');
  $('#authIdentifierWrap')?.classList.toggle('hidden',m==='register');$('#registerContactWrap')?.classList.toggle('hidden',m==='login');
  $('#displayNameWrap')?.classList.toggle('hidden',m==='login');$('#usernameWrap')?.classList.toggle('hidden',m==='login');
  if($('#authIdentifier'))$('#authIdentifier').required=m==='login';if($('#authEmail'))$('#authEmail').required=m==='register';if($('#authPhone'))$('#authPhone').required=m==='register';
  if($('#authSubmit'))$('#authSubmit').textContent=m==='login'?'Masuk':'Daftar';if($('#authPassword'))$('#authPassword').autocomplete=m==='login'?'current-password':'new-password';if($('#authMessage'))$('#authMessage').textContent='';if($('#googleCompleteWrap'))$('#googleCompleteWrap').classList.add('hidden');if($('#authForm'))$('#authForm').classList.remove('hidden');if($('#googleSignIn'))$('#googleSignIn').classList.remove('hidden');renderGoogleButton();
}
function hideMainPanels(){['profilePage','messagesPage','albumPage'].forEach(id=>$('#'+id)?.classList.add('hidden'));$('.hero')?.classList.remove('hidden');$('.composer')?.classList.remove('hidden');$('.grid')?.classList.remove('hidden');$('#friendsPanel')?.classList.add('hidden')}
function showView(v){hideMainPanels();if(v==='home')return loadFeed();if(v==='videos'||v==='photos'){const type=v==='videos'?'video':'image';$('#feed').innerHTML=currentPosts.filter(p=>p.media_type===type).map(postCard).join('')||'<div class="panel empty">Belum ada konten.</div>';attachPostEvents();return}if(v==='creator')return loadCreator();if(v==='notifications')return loadNotifications();if(v==='messages')return openMessages();if(v==='settings')return showSettings();if(v==='friends')return showFriends('friends');if(v==='photo-albums')return loadAlbumsPage('photo');if(v==='video-albums')return loadAlbumsPage('video')}
$('#authForm')?.addEventListener('submit',auth);$('#googleCompleteBtn')?.addEventListener('click',async()=>{if(!googlePendingCredential)return;const phone=$('#googlePhone')?.value.trim();if(!phone)return $('#authMessage').textContent='Nomor HP wajib diisi.';const btn=$('#googleCompleteBtn');btn.disabled=true;try{const d=await api('/auth/google',{method:'POST',body:JSON.stringify({credential:googlePendingCredential,phone,display_name:$('#displayName').value.trim(),username:$('#username').value.trim()})});googlePendingCredential='';await finishGoogleLogin(d,'Akun berhasil dibuat dengan Google.')}catch(e){$('#authMessage').textContent=e.message}finally{btn.disabled=false}});$('#loginTab')?.addEventListener('click',()=>setAuthMode('login'));$('#registerTab')?.addEventListener('click',()=>setAuthMode('register'));$('#authSideBtn')?.addEventListener('click',()=>{if(currentUser){localStorage.removeItem(TOKEN_KEY);currentUser=null;stopNotificationPolling();updateUserUI();status('Anda sudah keluar.');loadFeed()}else open('authModal')});$('#profileBtn')?.addEventListener('click',()=>currentUser?showProfile(currentUser.id):open('authModal'));$('#composerInput')?.addEventListener('click',()=>createPost('text'));$('#photoBtn')?.addEventListener('click',()=>createPost('image'));$('#videoBtn')?.addEventListener('click',()=>createPost('video'));$('#chooseMedia')?.addEventListener('click',()=>$('#mediaInput')?.click());$('#postVisibility')?.addEventListener('change',updateAudienceUI);$('#selectAllFriends')?.addEventListener('click',()=>$$('#selectedFriendsList input[type=checkbox]').forEach(x=>x.checked=true));$('#startLiveBtn')?.addEventListener('click',startLive);$('#endLiveBtn')?.addEventListener('click',endLive);$('#monetizeBtn')?.addEventListener('click',loadCreator);$('#dashboardBtn')?.addEventListener('click',loadCreator);$('#earningsBtn')?.addEventListener('click',loadCreator);$('#notificationBtn')?.addEventListener('click',loadNotifications);$('#messageBtn')?.addEventListener('click',openMessages);
function navigateView(a){if(!a)return;$$('#mainNav a,#mobileNav a').forEach(x=>x.classList.toggle('active',x.dataset.view===a.dataset.view));showView(a.dataset.view)}
$('#mainNav')?.addEventListener('click',e=>{const a=e.target.closest('a[data-view]');if(!a)return;e.preventDefault();navigateView(a)});
$('#mobileNav')?.addEventListener('click',e=>{const a=e.target.closest('a[data-view]');if(!a)return;e.preventDefault();navigateView(a)});
$('#mobileAuthBtn').onclick=()=>$('#authSideBtn').click();
$$('[data-friend-tab]').forEach(b=>b.onclick=()=>loadFriends(b.dataset.friendTab,$('#friendSearch').value.trim()));
$$('[data-close]').forEach(b=>b.onclick=()=>{if(b.dataset.close==='authModal'&&!currentUser){enforceAuthGate();return}if(b.dataset.close==='messageModal')stopChatPolling();close(b.dataset.close)});$$('.modal').forEach(m=>m.addEventListener('click',e=>{if(e.target===m){if(m.id==='authModal'&&!currentUser){enforceAuthGate();return}if(m.id==='messageModal')stopChatPolling();m.classList.add('hidden')}}));
$('#searchInput')?.addEventListener('input',e=>{const m=$('#mobileSearchInput');if(m)m.value=e.target.value;loadFeed(e.target.value.trim())});
$('#mobileSearchInput')?.addEventListener('input',e=>{const d=e.target.value.trim();$('#searchInput').value=e.target.value;loadFeed(d)});$('#friendSearch')?.addEventListener('input',e=>{if(currentFriendTab==='discover')loadFriends('discover',e.target.value.trim())});
$('#mediaViewerClose')?.addEventListener('click',closeMediaViewer);$('#mediaViewer')?.addEventListener('click',e=>{if(e.target.id==='mediaViewer')closeMediaViewer()});document.addEventListener('keydown',e=>{if(e.key==='Escape'){closeMediaViewer();['authModal','creatorModal','profileModal','notificationModal','commentModal','composeModal','messageModal','settingsModal','avatarCropModal','liveModal'].forEach(id=>close(id))}});$('#composeForm')?.addEventListener('submit',publishPost);$('#mediaInput')?.addEventListener('change',e=>{const files=[...(e.target.files||[])];if(!files.length){selectedMedia=[];previewSelectedMedia([]);return}if(files.length>10){e.target.value='';selectedMedia=[];previewSelectedMedia([]);return status('Maksimal 10 foto/video sekaligus.',true)}const postKind=e.target.dataset.postKind;if(postKind==='image'&&files.some(f=>!f.type.startsWith('image/'))){e.target.value='';selectedMedia=[];previewSelectedMedia([]);return status('Mode foto hanya menerima gambar.',true)}if(postKind==='video'&&files.some(f=>!f.type.startsWith('video/'))){e.target.value='';selectedMedia=[];previewSelectedMedia([]);return status('Mode video hanya menerima video.',true)}if(files.some(f=>f.size>100*1024*1024)){e.target.value='';selectedMedia=[];previewSelectedMedia([]);return status('Setiap file maksimal 100 MB.',true)}selectedMedia=files;previewSelectedMedia(files)});$('#changeAvatarBtn').onclick=()=>$('#avatarInput').click();$('#avatarInput').onchange=e=>{const f=e.target.files[0];if(f)uploadAvatar(f);e.target.value=''};$('#avatarCropCancel').onclick=closeAvatarCrop;$('#avatarCropReset').onclick=resetAvatarCrop;$('#avatarCropSave').onclick=saveCroppedAvatar;$('#avatarCropZoom').oninput=e=>{avatarCrop.scale=Number(e.target.value)||1;positionAvatarCrop()};$('#avatarCropStage').addEventListener('pointerdown',e=>{if(!avatarCrop.img)return;avatarCrop.drag=true;avatarCrop.sx=e.clientX;avatarCrop.sy=e.clientY;avatarCrop.ox=avatarCrop.x;avatarCrop.oy=avatarCrop.y;$('#avatarCropImage').classList.add('dragging');e.currentTarget.setPointerCapture?.(e.pointerId)});$('#avatarCropStage').addEventListener('pointermove',e=>{if(!avatarCrop.drag)return;avatarCrop.x=avatarCrop.ox+(e.clientX-avatarCrop.sx);avatarCrop.y=avatarCrop.oy+(e.clientY-avatarCrop.sy);positionAvatarCrop()});['pointerup','pointercancel','pointerleave'].forEach(ev=>$('#avatarCropStage').addEventListener(ev,()=>{avatarCrop.drag=false;$('#avatarCropImage').classList.remove('dragging')}));
$('#saveSettings').onclick=async()=>{if(!requireLogin())return;const btn=$('#saveSettings');btn.disabled=true;$('#settingsMessage').textContent='Menyimpan profil...';try{const d=await api('/me',{method:'PUT',body:JSON.stringify({display_name:$('#settingsName').value.trim(),username:$('#settingsUsername').value.trim(),bio:$('#settingsBio').value.trim(),city:$('#settingsCity').value.trim(),work:$('#settingsWork').value.trim(),education:$('#settingsEducation').value.trim(),website:$('#settingsWebsite').value.trim()})});currentUser=d.user;updateUserUI();renderSettingsAvatar();$('#settingsMessage').textContent='Profil berhasil disimpan.';status('Profil berhasil diperbarui.')}catch(e){$('#settingsMessage').textContent=e.message;status(e.message,true)}finally{btn.disabled=false}};
function enforceAuthGate(){
  if(currentUser){$('#authModal')?.classList.remove('auth-required');return}
  $('#authModal')?.classList.add('auth-required');
  open('authModal');
}
function syncMobileAuth(){const b=$('#mobileAuthBtn');if(b)b.innerHTML=currentUser?'🚪<span>Keluar</span>':'🔐<span>Masuk</span>'}
initGoogleAuth();
const _updateUserUI=updateUserUI;updateUserUI=function(){_updateUserUI();syncMobileAuth()};
(async()=>{updateUserUI();await loadMe();await loadFeed();await loadEarnings();if(!currentUser)enforceAuthGate()})();
