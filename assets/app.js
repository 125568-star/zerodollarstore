import { createClient } from 'https://esm.sh/@supabase/supabase-js@2.118.0';

// This is the public Supabase publishable key (safe in a browser). Never put a service-role key here.
const SUPABASE_URL = 'https://fudujpxplvlrcwtdcaas.supabase.co';
const SUPABASE_PUBLIC_KEY = 'sb_publishable_cDLWnKhbvN-hPrwhbgBXcQ_dTgQApP0';
const db = createClient(SUPABASE_URL, SUPABASE_PUBLIC_KEY, {auth:{persistSession:true,autoRefreshToken:true,detectSessionInUrl:true}});
const BUCKET = 'zds-listing-images';
const q = (id) => document.getElementById(id);
const esc = (s='')=>String(s??'').replace(/[&<>"']/g,ch=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[ch]));
const safe = (s='')=>String(s??'').trim();
// Turn plain HTTP(S) addresses into safe clickable links without interpreting listing HTML.
function linkifyText(value=''){
 const source=String(value??'');
 const urlPattern=/(?:https?:\/\/|www\.)[^\s<>"']+/gi;
 let output='',cursor=0,match;
 while((match=urlPattern.exec(source))!==null){
  const raw=match[0], url=raw.replace(/[.,;:!?)\]]+$/g,'');
  output+=esc(source.slice(cursor,match.index));
  if(url){
   try{
    const parsed=new URL(/^www\./i.test(url)?'https://'+url:url);
    if(parsed.protocol==='http:'||parsed.protocol==='https:'){
     output+='<a class="listing-external-link" href="'+esc(parsed.href)+'" target="_blank" rel="noopener noreferrer" title="Open external website">'+esc(url)+'</a>';
    }else output+=esc(url);
   }catch(_error){output+=esc(url)}
  }
  output+=esc(raw.slice(url.length));
  cursor=match.index+raw.length;
 }
 return output+esc(source.slice(cursor));
}

const moneyRe = /(?:\$\s*\d|\b(?:payment|price\s*[:=]|deposit|paypal|bank transfer|postage fee|delivery fee|shipping fee|cash only|handling fee|venmo|payid)\b)/i;
const categoryIcons = {'furniture':'🛋️','electronics':'💻','home-appliances':'🏠','garden':'🌿','tools':'🧰','sports':'🚲','books':'📚','clothing':'👕','baby-kids':'🧸','pets':'🐶','building-materials':'🪚','other':'🎁','events':'📅','services-offered':'🛠️'};
const categoryColors=['#edf2e5','#e8eefe','#fff2e4','#e9f3e5','#fff0e5','#e5f5f7'];
let adminAccess=false, accountBanned=false, adminSeenNotices=null, adminChecking=false, currentEmailDraft=null, listingView=document.body.dataset.page==='wanted'?'want':'have', identitySerial=0;
const adminParams=new URLSearchParams(location.search);
let adminSection=['listings','requests','bans','reports'].includes(adminParams.get('section'))?adminParams.get('section'):'listings';
let adminFilter=['pending','approved','rejected','hidden','all'].includes(adminParams.get('filter'))?adminParams.get('filter'):'pending';
let pendingApprovalEmailLink=adminParams.get('review')==='pending';
if(document.body.dataset.page==='admin'){
 const initialTitles={listings:'Listing moderation',requests:'Wanted requests',bans:'Banned accounts',reports:'Member reports'};
 const initialTitle=initialTitles[adminSection]||initialTitles.listings;
 if(q('adminTitle'))q('adminTitle').textContent=initialTitle;
 document.title=initialTitle+' | Zero Dollar Store admin';
}
 let session=null, categories=[], listings=[], imagesByListing={}, favorites=new Set(), selectedCategory='all', categoryNotFound=false, searchTerm='', searchArea='', toastTimeout;
function toast(msg){const el=q('toast');clearTimeout(toastTimeout);el.textContent=msg;el.classList.add('show');toastTimeout=setTimeout(()=>el.classList.remove('show'),4500)}
function openModal(content,large=false){q('modalBody').className='modal'+(large?' large':'');q('modalBody').innerHTML=`<button class="modal-close" aria-label="Close" data-close>×</button>`+content;q('modalOverlay').classList.add('show');document.body.style.overflow='hidden'}
function closeModal(){q('modalOverlay').classList.remove('show');document.body.style.overflow=''}
const currentUser=()=>session?.user || null;
function humanAge(ts){const hours=Math.max(0,Math.floor((Date.now()-new Date(ts).getTime())/3600000));if(hours<1)return 'Just now';if(hours<24)return `${hours}h ago`;const days=Math.floor(hours/24);return days<30?`${days}d ago`:new Date(ts).toLocaleDateString('en-AU')}
function categoryName(id){return categories.find(x=>String(x.id)===String(id))?.name||'Other'}
function categoryEmoji(id){const slug=categories.find(x=>String(x.id)===String(id))?.slug;return categoryIcons[slug]||'🎁'}
function photoUrl(image){if(!image)return '';return db.storage.from(BUCKET).getPublicUrl(image.storage_path).data.publicUrl}
async function fetchCategories(){const {data,error}=await db.from('categories').select('id,name,slug,display_order').order('display_order');if(error)throw error;categories=data||[];
 if(document.body.dataset.page==='category'){
  const params=new URLSearchParams(location.search),slug=params.get('category')||'',cat=categories.find(x=>x.slug===slug);
  categoryNotFound=!cat;selectedCategory=cat?String(cat.id):'__not_found__';
  if(params.get('view')==='want')listingView='want';
  if(q('categoryTitle'))q('categoryTitle').textContent=cat?.name||'Category not found';
  if(q('categoryIcon'))q('categoryIcon').textContent=cat?categoryEmoji(cat.id):'📂';
  if(q('categoryDescription'))q('categoryDescription').textContent=cat?(`Browse free listings in ${cat.name}. Every item costs $0.`):'Choose a category from the browse page.';
  if(cat){document.title=`${cat.name} | Zero Dollar Store`;const description=document.querySelector('meta[name="description"]');if(description)description.content=`Free ${cat.name} listings on Zero Dollar Store. Every item costs $0.`;}
 }
 drawCategories()}
function drawCategories(){
 if(!q('categoryGrid'))return;
 const current=listings.filter(l=>(l.listing_type||'have')===listingView && (!l.expires_at||new Date(l.expires_at).getTime()>Date.now()));
 const counts=new Map();
 current.forEach(l=>counts.set(String(l.category_id),(counts.get(String(l.category_id))||0)+1));
 q('categoryGrid').innerHTML=`<a class="category" href="browse.html#browse"><span class="cat-emoji">✨</span>All items <small class="category-count">(${current.length})</small></a>`+categories.map(cat=>`<a class="category" href="category.html?category=${encodeURIComponent(cat.slug)}${listingView==='want'?'&view=want':''}"><span class="cat-emoji">${categoryIcons[cat.slug]||'🎁'}</span>${esc(cat.name)} <small class="category-count">(${counts.get(String(cat.id))||0})</small></a>`).join('');
}
async function fetchListings(){const {data,error}=await db.from('listings').select('id,owner_id,listing_type,title,description,category_id,item_condition,suburb,state,postcode,status,created_at,expires_at,event_image_url').in('status',['available','reserved']).eq('moderation_status','approved').order('created_at',{ascending:false}).limit(200);if(error)throw error;listings=(data||[]).filter(x=>!x.expires_at||new Date(x.expires_at).getTime()>Date.now());const ids=listings.map(x=>x.id);imagesByListing={};if(ids.length){const {data:ims}=await db.from('listing_images').select('listing_id,storage_path,display_order').in('listing_id',ids).order('display_order');(ims||[]).forEach(im=>(imagesByListing[im.listing_id]??=[]).push(im))}drawCategories();drawListings()}
function sampleCards(){const examples=[['Two-seater couch','🛋️'],['Adult bicycle','🚲'],['Healthy houseplant','🪴'],['Books & magazines','📚']];return examples.map(([name,icon],i)=>`<article class="item-card" aria-label="Example listing: ${esc(name)}"><div class="item-image" style="background:${categoryColors[i]}"><div class="emoji-placeholder">${icon}</div><span class="example-label">EXAMPLE — NOT LIVE</span></div><div class="item-body"><h3>${esc(name)}</h3><div class="listing-price">$0 <small>FREE</small></div><div class="condition">Illustrative example</div><div class="item-footer"><strong>Local pickup</strong><span>Example</span></div></div></article>`).join('')}
function drawListings(){if(!q('itemsGrid'))return;drawCategories();let arr=listings.filter(l=> (!l.expires_at || new Date(l.expires_at).getTime()>Date.now()) && (l.listing_type||'have')===listingView && (selectedCategory==='all'||String(l.category_id)===selectedCategory) && (!searchTerm||`${l.title} ${l.description}`.toLowerCase().includes(searchTerm.toLowerCase())) && (!searchArea || `${l.suburb} ${l.postcode||''} ${l.state}`.toLowerCase().includes(searchArea.toLowerCase())));if(q('sortBy').value==='alpha')arr.sort((a,b)=>a.title.localeCompare(b.title));q('browseHeading').textContent=document.body.dataset.page==='category'?`${categoryName(selectedCategory)} — ${listingView==='want'?'wanted requests':'$0 items'}`:listingView==='want'?'I Need This — wanted requests':selectedCategory==='all'?'Recently listed — all $0':`${categoryName(selectedCategory)} — all $0`;q('resultCount').textContent=`${arr.length} ${listingView==='want'?'wanted request':'real listing'}${arr.length===1?'':'s'}`;document.querySelectorAll('[data-listing-view]').forEach(x=>x.setAttribute('aria-pressed',String(x.dataset.listingView===listingView)));

  if(!arr.length){if(document.body.dataset.page==='category'){q('itemsGrid').innerHTML=`<div class="empty"><div style="font-size:36px">${categoryNotFound?'📂':'🔎'}</div><h3>${categoryNotFound?'Category not found':`No ${esc(categoryName(selectedCategory))} listings yet`}</h3><p>${categoryNotFound?'Choose a category from the browse page.':'There are no listings in this category right now.'}</p><a class="btn" href="browse.html#categories">Browse all categories →</a></div>`;return;}const hasKind=listings.some(item=>(item.listing_type||'have')===listingView);q('itemsGrid').innerHTML=`<div class="empty"><div style="font-size:36px">🔎</div><h3>${hasKind?'No items matched':listingView==='want'?'No wanted requests yet':'Be the first to list something!'}</h3><p>${hasKind?'Try removing your search filters.':listingView==='want'?'Post what you need so someone who has it can help.':'The marketplace is ready for real listings. Every item costs $0.'}</p><button class="btn" data-post="${listingView}">${listingView==='want'?'Post a wanted request →':'List an item for free →'}</button></div>`+(listingView==='want'||hasKind?'':sampleCards());return;}
  let cards=arr.map(l=>{const want=l.listing_type==='want';const kind=categories.find(c=>String(c.id)===String(l.category_id))?.slug;const activity=kind==='events'||kind==='services-offered';const image=imagesByListing[l.id]?.[0];const externalPicture=(kind==='events' && /^https:\/\//.test(l.event_image_url||''))?l.event_image_url:null;const img=image?`<img loading="lazy" src="${esc(photoUrl(image))}" alt="${esc(l.title)}">`:externalPicture?`<img loading="lazy" src="${esc(externalPicture)}" alt="Event picture: ${esc(l.title)}">`:`<div class="emoji-placeholder">${categoryEmoji(l.category_id)}</div>`;return `<article class="item-card" role="button" tabindex="0" data-item="${l.id}"><div class="item-image">${img}<span class="free-chip">${want?'WANTED':'$0 · FREE'}</span><button type="button" class="save ${favorites.has(l.id)?'saved':''}" data-save="${l.id}" aria-label="Save listing">${favorites.has(l.id)?'♥':'♡'}</button></div><div class="item-body"><h3>${esc(l.title)}</h3>${want?'<span class="wanted-chip">I WANT THIS · FREE / EXCHANGE</span>':'<div class="listing-price">$0 <small>FREE</small></div>'}<div class="condition">${want?(activity?'Looking for this activity':'Looking for this item'):kind==='events'?'Free event':kind==='services-offered'?'Free service offered':esc(l.item_condition.replace('_',' '))+' · Collection only'}</div><div class="item-footer"><strong>📍 ${esc(l.suburb)}, ${esc(l.state)}</strong><span>${humanAge(l.created_at)}</span></div>${adminAccess?`<div style="margin-top:10px"><button type="button" class="admin-card-delete" data-admin-delete="${l.id}">🗑 Delete (admin)</button></div>`:""}</div></article>`});if(cards.length>=4)cards.splice(4,0,`<article class="ad-card"><div class="ad-label">ADVERTISEMENT SPACE</div><div class="ad-icon">📣</div><h3>Your business could advertise here</h3><p>Ground Support Crew funds the marketplace; future advertising can help with running costs.</p></article>`);q('itemsGrid').innerHTML=cards.join('');}
async function loadFavorites(){favorites=new Set();if(!currentUser())return;const {data}=await db.from('favorites').select('listing_id');(data||[]).forEach(x=>favorites.add(x.listing_id));}
async function refresh(){try{await Promise.all([fetchCategories(),fetchListings()]);await loadFavorites();drawListings()}catch(e){q('itemsGrid').innerHTML=`<div class="empty"><h3>Cannot load listings right now</h3><p>${esc(e.message)}</p></div>`;toast('Supabase connection problem. Check network and project configuration.')}}

const oauthNames={google:'Google',facebook:'Facebook',azure:'Microsoft / Outlook'};
const oauthReady={google:false,facebook:false,azure:false};
async function loadOAuthAvailability(){
  const box=q('modalBody'); if(!box || !box.querySelector('[data-oauth]'))return;
  try {
    const response=await fetch(SUPABASE_URL+'/auth/v1/settings',{headers:{'apikey':SUPABASE_PUBLIC_KEY}});
    if(!response.ok)return;
    const settings=await response.json();
    for(const [provider,name] of Object.entries(oauthNames)){
      const button=box.querySelector(`[data-oauth="${provider}"]`);
      if(!button)return;
      oauthReady[provider]=settings.external?.[provider]===true;
      button.disabled=!oauthReady[provider];
      button.title=oauthReady[provider]?`Continue with ${name}`:`${name} sign-in has not been enabled`;
      const status=button.querySelector('.oauth-status');
      if(status)status.textContent=oauthReady[provider]?'Available':'Not yet available';
    }
  }catch(_error){ /* Safe default: disabled until provider configuration is verified. */ }
}
function authFeedback(message,isError=false){
 const node=q('authFeedback');if(!node){toast(message);return;}
 node.hidden=false;node.style.border='1px solid '+(isError?'#e5a09a':'#a5d3b8');
 node.style.background=isError?'#fff1ef':'#eef9f0';node.style.color=isError?'#8a2e29':'#236145';
 node.style.borderRadius='10px';node.style.padding='12px';node.style.fontSize='13px';node.style.lineHeight='1.5';
 node.textContent=message;node.scrollIntoView({block:'nearest',behavior:'smooth'});
}
function showAuth(){openModal(`<h2>Welcome to Zero Dollar Store</h2><p class="sub">Join to list free items, message owners and arrange local collection. No payments, ever.</p><button class="auth-btn" type="button" data-oauth="google" disabled><span class="auth-mark" style="color:#4285f4;font-weight:900">G</span> Continue with Google <small class="oauth-status" style="font-size:10px;margin-left:auto;color:#677a70">Not yet available</small></button><button class="auth-btn" type="button" data-oauth="facebook" disabled><span class="auth-mark" style="color:#1877f2;font-weight:900">f</span> Continue with Facebook <small class="oauth-status" style="font-size:10px;margin-left:auto;color:#677a70">Not yet available</small></button><button class="auth-btn" type="button" data-oauth="azure" disabled><span class="auth-mark">▦</span> Continue with Microsoft / Outlook <small class="oauth-status" style="font-size:10px;margin-left:auto;color:#677a70">Not yet available</small></button><div class="or">or use your email</div><form id="authForm"><p id="authFeedback" role="status" aria-live="polite" hidden></p><div class="field"><label for="authEmail">Email address</label><input type="email" id="authEmail" autocomplete="email" required placeholder="you@example.com"></div><div class="field"><label for="authPassword">Password</label><input type="password" id="authPassword" autocomplete="current-password" minlength="8" required placeholder="At least 8 characters"></div><div class="newsletter-choice"><label><input id="authNewsletter" type="checkbox"> Subscribe me to free finds and sponsored newsletters (optional).</label><small>Unsubscribe at any time. You can join without subscribing.</small></div><div style="display:flex;gap:8px;flex-wrap:wrap"><button type="submit" class="btn" data-mode="signup">Create free account</button><button type="submit" class="btn btn-ghost" data-mode="login">Log in</button></div>
<div style="display:flex;flex-wrap:wrap;gap:12px;margin:15px 0 0;font-size:12px">
  <button type="button" class="a-link" data-auth-action="resend" style="border:0;background:none;padding:0;cursor:pointer">Resend confirmation email</button>
  <button type="button" class="a-link" data-auth-action="recover" style="border:0;background:none;padding:0;cursor:pointer">Forgot password?</button>
</div></form><p class="modal-note">Email accounts require confirmation. After registering, open the confirmation message in your inbox (including spam), click its link, then return to log in. Social sign-in becomes available once each provider is configured.</p>`,true);loadOAuthAvailability().catch(()=>{})}
async function authenticate(mode){
 const form=q('authForm'),email=q('authEmail').value.trim(),password=q('authPassword').value,opt=q('authNewsletter').checked;
 if(!email||!password)return;
 const buttons=[...form.querySelectorAll('button[type="submit"]')];
 buttons.forEach(button=>button.disabled=true);
 authFeedback(mode==='signup'?'Creating your free account…':'Signing in…');
 try{
  const options={emailRedirectTo:location.origin+location.pathname,data:{newsletter_opt_in:opt}};
  const result=mode==='signup' ? await db.auth.signUp({email,password,options}) : await db.auth.signInWithPassword({email,password});
  if(result.error)throw result.error;
  if(mode==='signup'&&!result.data?.session){
   authFeedback('Registration received. Check your email for a confirmation link, including the spam folder. Confirm your address before attempting to log in. If you previously registered with this address, use Log in instead.');
   q('authPassword').value='';
   return;
  }
  if(mode==='signup' && opt){try{await setNewsletter(true)}catch(_error){ /* Consent was recorded at registration. */ }}
  closeModal();toast(mode==='signup'?'Your account is ready. You are signed in!':'Signed in successfully.');
 }catch(error){
  const message=String(error?.message||'Unknown authentication error');
  if(/already registered|duplicate key|unique constraint|user already exists/i.test(message))authFeedback('This email is already registered. Use Log in, or confirm the verification email you received earlier.',true);
  else if(/email not confirmed/i.test(message))authFeedback('Your email still needs confirmation. The earlier activation link may have expired or already been opened. Click “Resend confirmation email” below, then use the newest email link.',true);
  else if(/invalid login credentials/i.test(message))authFeedback('Supabase rejected the password or the account is not fully confirmed. Try “Resend confirmation email” or “Forgot password?” below. You do not need to register again.',true);
  else if(/rate limit|too many requests/i.test(message))authFeedback('Too many attempts. Please try again later. Check for a verification email you may already have received.',true);
  else authFeedback('Registration or login could not finish: '+message,true);
 }finally{buttons.forEach(button=>button.disabled=false)}
}
async function handleAuthHelp(action){
 const address=q('authEmail')?.value.trim();
 if(!address || !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(address)){
   authFeedback('Enter your email address above first, then click the confirmation or password reset link.',true);
   q('authEmail')?.focus();return;
 }
 const sender=q('modalBody')?.querySelector('[data-auth-action="'+action+'"]');
 if(sender)sender.disabled=true;
 authFeedback(action==='resend'?'Requesting a fresh confirmation email…':'Requesting password recovery email…');
 try{
   const landing=location.origin+location.pathname;
   const response=action==='resend'
     ? await db.auth.resend({type:'signup',email:address,options:{emailRedirectTo:landing}})
     : await db.auth.resetPasswordForEmail(address,{redirectTo:landing});
   if(response.error)throw response.error;
   authFeedback(action==='resend'
     ? 'If this account still needs confirmation, a fresh email has been requested. Open the newest message and click its link once. Older links may no longer work.'
     : 'If the account exists, check your email for a password reset link. Open the newest message.');
 }catch(error){
   authFeedback('Email could not be requested: '+String(error?.message||error),true);
 }finally{if(sender)sender.disabled=false}
}
async function showPasswordRecovery(){
 openModal('<h2>Set a new password</h2><p class="sub">You followed a password recovery link. Choose a new password below.</p><form id="passwordRecoveryForm"><div class="field"><label>New password</label><input name="password" type="password" autocomplete="new-password" minlength="8" required></div><button class="btn full" type="submit">Save new password</button><p id="recoveryFeedback" role="status" aria-live="polite"></p></form>',true);
}
async function doOAuth(provider){
 if(!oauthReady[provider])return authFeedback((oauthNames[provider]||'This provider')+' login is not configured yet. Use email registration for now.',true);
 try{
  const {error}=await db.auth.signInWithOAuth({provider,options:{redirectTo:location.origin+location.pathname,...(provider==='azure'?{scopes:'email'}:{})}});
  if(error)throw error;
 }catch(error){authFeedback('Could not sign in with '+(oauthNames[provider]||provider)+': '+error.message,true)}
}
async function setNewsletter(opt){if(!currentUser())return toast('Sign in first to change newsletter settings.');const userId=currentUser().id;const now=new Date().toISOString();const payload={user_id:userId,opted_in:opt,consent_at:opt?now:null,unsubscribed_at:opt?null:now};const {error}=await db.from('newsletter_preferences').upsert(payload,{onConflict:'user_id'});if(error)throw error;toast(opt?'Newsletter subscription saved.':'You have unsubscribed.');}
async function showAccount(){const u=currentUser();if(!u)return showAuth();const {data:newsletter}=await db.from('newsletter_preferences').select('opted_in').eq('user_id',u.id).maybeSingle();openModal(`<h2>My account</h2><p class="sub">Signed in as <strong>${esc(u.email||'member')}</strong></p><button class="btn full" data-action="myListings">Manage my listings</button>${adminAccess?'<button class="btn full" data-action="adminPanel" style="margin-top:10px">🛡️ Admin moderation — review & approve listings</button>':''}${accountBanned?'<p class="modal-note">This account is banned from participating in the marketplace.</p>':''}<button class="btn btn-ghost full" data-action="inbox" style="margin-top:10px">My messages</button><button class="btn btn-ghost full" data-action="favorites" style="margin-top:10px">Saved items</button><div class="newsletter-choice"><label><input id="accountNewsletter" type="checkbox" ${newsletter?.opted_in?'checked':''}> Receive newsletter emails with free finds and clearly labelled sponsored messages</label><button class="btn btn-soft" data-action="saveNewsletter" type="button">Save newsletter preference</button></div><button class="btn btn-ghost full" data-action="logout">Log out</button>`,true)}
function showPost(type='have'){if(typeof type!=='string'||!['have','want'].includes(type))type='have';if(!currentUser())return showAuth();if(accountBanned)return toast('This account is banned from posting.');openModal(`<h2>Post: I have this / I want this</h2><p class="sub">Give away an item, offer a free service, list a free event, or request something you need. Every post must be approved before it is visible. No payments or delivery fees.</p><div class="points-form-note"><strong>★ Earn Zero Dollar Points</strong> Giveaways earn 5 points plus 2 per photo (up to five) after approval. Wanted requests do not earn points. Future rewards will be announced.</div><form id="postForm"><div class="field"><label>Choose the type of post</label><select name="listing_type" required><option value="have" ${type==="have"?"selected":""}>🎁 I have this — give it away free</option><option value="want" ${type==="want"?"selected":""}>🔎 I want this — looking for it</option></select></div><div class="field"><label>Listing title</label><input name="title" maxlength="150" minlength="3" placeholder="e.g. Working coffee machine" required></div><div class="field"><label>Category</label><select name="category" required>${categories.map(c=>`<option value="${c.id}">${esc(c.name)}</option>`).join('')}</select></div><p class="filehint">Events and services must be completely free. Include event date/time or service availability in the description.</p><div class="field" data-item-condition><label>Condition / preferred condition</label><select name="condition"><option value="good">Good / usable</option><option value="new">New</option><option value="fair">Fair</option><option value="for_parts">For parts</option></select></div><div class="field"><label>Suburb / location</label><input name="suburb" maxlength="100" required placeholder="e.g. Kuraby"></div><div class="field"><label>Australian state or territory</label><select name="state"><option>QLD</option><option>NSW</option><option>VIC</option><option>WA</option><option>SA</option><option>ACT</option><option>TAS</option><option>NT</option></select></div><div class="field"><label>Postcode (optional)</label><input name="postcode" pattern="[0-9]{4}" maxlength="4" inputmode="numeric" placeholder="e.g. 4112"></div><div class="field"><label>Description</label><textarea name="description" maxlength="5000" rows="4" placeholder="Describe the free item, event or service. For events include the date, time and location; for services include availability. No fees or payment requests." required></textarea></div><div class="field"><label>Photos (up to 5, JPG/PNG/WebP, 8 MB each)</label><input name="photos" type="file" accept="image/jpeg,image/png,image/webp" multiple></div><button class="btn full" type="submit">Submit listing for admin approval →</button></form>`,true);updateActivityCategoryForm(q('postForm'))}

function updateActivityCategoryForm(form){
 if(!form)return;
 const id=form.elements.category?.value;
 const slug=categories.find(c=>String(c.id)===String(id))?.slug;
 const activity=slug==='events'||slug==='services-offered';
 const conditionField=form.querySelector('[data-item-condition]');
 if(conditionField)conditionField.hidden=activity;
 if(activity&&form.elements.condition)form.elements.condition.value='good';
 const description=form.elements.description;
 if(description){
  description.placeholder=slug==='events'
   ?'Describe the free event, date, time, venue and any access details. No paid tickets or fees.'
   :slug==='services-offered'
   ?'Describe the service offered entirely free of charge, your availability, and where you can help.'
   :'Describe the item you have or need, including its condition and free collection arrangements.';
 }
}

async function saveListing(form){const u=currentUser();if(!u)return showAuth();const f=new FormData(form);const listing_type=f.get('listing_type');if(!['have','want'].includes(listing_type))throw new Error('Choose I have this or I want this.');const title=safe(f.get('title')),description=safe(f.get('description'));if(moneyRe.test(title+' '+description))throw new Error('No payment requests or prices are allowed in free listings.');const files=[...(form.elements.photos.files||[])];if(files.length>5)throw new Error('Choose no more than 5 photos.');for(const file of files)if(file.size>8*1024*1024||!['image/jpeg','image/png','image/webp'].includes(file.type))throw new Error('Photos must be JPG, PNG or WebP and smaller than 8 MB each.');const {data,error}=await db.from('listings').insert({owner_id:u.id,listing_type,category_id:Number(f.get('category')),title,description,item_condition:f.get('condition'),suburb:safe(f.get('suburb')),state:f.get('state'),postcode:safe(f.get('postcode'))||null}).select('id').single();if(error)throw error;let failed=0;for(const [i,file] of files.entries()){const ext=({ 'image/jpeg':'jpg','image/png':'png','image/webp':'webp'})[file.type];const path=`${u.id}/${data.id}/${crypto.randomUUID()}.${ext}`;const upload=await db.storage.from(BUCKET).upload(path,file,{contentType:file.type,upsert:false});if(upload.error){failed++;continue;}const stored=await db.from('listing_images').insert({listing_id:data.id,storage_path:path,display_order:i});if(stored.error)failed++}toast(failed?`Submitted for review. ${failed} photo(s) couldn't be saved.`:listing_type==='want'?'Your wanted request is awaiting admin approval.':'Your free item is awaiting admin approval.');closeModal();await fetchListings()}
function showItem(id){
 const l=listings.find(x=>x.id===id);if(!l)return;
 const mine=l.owner_id===currentUser()?.id,want=l.listing_type==='want';
 const isEvent=categories.find(x=>String(x.id)===String(l.category_id))?.slug==='events';
 const photos=(imagesByListing[id]||[]).map(x=>'<img src="'+esc(photoUrl(x))+'" alt="Photo of '+esc(l.title)+'">').join('') || (isEvent && /^https:\/\//.test(l.event_image_url||'')?'<img src="'+esc(l.event_image_url)+'" alt="Event picture: '+esc(l.title)+'" loading="lazy">':'');
 const actions=mine
   ?'<div class="admin-actions"><button class="btn btn-soft" data-edit-listing="'+l.id+'">✏️ Edit / send for approval</button>'+(isEvent?'':'<button class="btn" data-status="reserved" data-id="'+l.id+'">Mark '+(want?'arranging':'reserved')+'</button><button class="btn" data-status="collected" data-id="'+l.id+'">Mark '+(want?'fulfilled':'collected')+'</button>')+'<button class="btn btn-ghost" data-status="removed" data-id="'+l.id+'">Remove my post</button></div>'
   :'<button class="btn full" data-contact="'+l.id+'">'+(want?'I can help — message requester →':'I want this — message owner →')+'</button><button class="btn btn-ghost full" data-report="'+l.id+'" style="margin-top:8px">Report listing</button>';
 const adminDelete=adminAccess?'<div class="admin-actions"><button class="admin-card-delete" data-admin-delete="'+l.id+'">🗑 Delete listing (admin)</button></div>':'';
 openModal('<h2>'+esc(l.title)+'</h2><p class="sub"><strong>'+(isEvent?'📅 FREE EVENT':want?'🔎 I WANT THIS':'🎁 I HAVE THIS')+'</strong> · '+(isEvent?'Free event, $0':want?'Free request / voluntary exchange':'Free giveaway, $0')+'</p>'+
 '<p class="sub">📍 '+esc(l.suburb)+', '+esc(l.state)+' · '+esc(categoryName(l.category_id))+'</p>'+
 '<div class="photos-row">'+(photos||'<div style="font-size:70px">'+categoryEmoji(l.category_id)+'</div>')+'</div>'+
 '<p class="listing-description" style="white-space:pre-wrap">'+linkifyText(l.description||'No details provided')+'</p>'+
 (isEvent?'':'<p class="modal-note">Arrangements may include pickup or free delivery; wanted requests can also offer a voluntary exchange. No payments, postage charges or deposits.</p>')+
 actions+adminDelete,true);
}
async function setStatus(id,status){const {error}=await db.from('listings').update({status}).eq('id',id).eq('owner_id',currentUser().id);if(error)throw error;closeModal();toast('Listing status updated.');await fetchListings()}
async function contactOwner(id){if(!currentUser())return showAuth();const {data:existing,error:lookupError}=await db.from('conversations').select('id').eq('listing_id',id).eq('requester_id',currentUser().id).maybeSingle();if(lookupError)throw lookupError;let convId=existing?.id;if(!convId){const {data,error}=await db.from('conversations').insert({listing_id:id,requester_id:currentUser().id}).select('id').single();if(error)throw error;convId=data.id;}await showThread(convId)}
async function showThread(id){if(!currentUser())return showAuth();const {data:thread,error}=await db.from('conversations').select('id,listing_id,requester_id,listings(title,owner_id)').eq('id',id).single();if(error)throw error;const {data:messages,error:err}=await db.from('messages').select('id,sender_id,body,created_at').eq('conversation_id',id).order('created_at');if(err)throw err;openModal(`<h2>Messages about ${esc(thread.listings?.title||'an item')}</h2><p class="sub">Arrange a collection time, free delivery or a voluntary exchange as appropriate. Never send money.</p><div id="threadMessages" style="max-height:360px;overflow-y:auto">${messages?.length?messages.map(m=>`<div class="msg ${m.sender_id===currentUser().id?'mine':''}">${esc(m.body)}<small>${m.sender_id===currentUser().id?'You':'Other member'} · ${new Date(m.created_at).toLocaleString('en-AU')}</small></div>`).join(''):'<p class="muted">Start the conversation.</p>'}</div><form id="sendMessage" data-thread="${id}"><div class="field"><label>Message</label><textarea name="body" maxlength="4000" required placeholder="Hi! Is this still available for collection?"></textarea></div><button type="submit" class="btn full">Send message →</button></form>`,true);q('threadMessages').scrollTop=q('threadMessages').scrollHeight}
async function sendMessage(form){const id=form.dataset.thread,body=safe(new FormData(form).get('body'));if(!body) return;if(moneyRe.test(body))throw new Error('Please do not request payment through the marketplace.');const {error}=await db.from('messages').insert({conversation_id:id,sender_id:currentUser().id,body});if(error)throw error;await showThread(id)}
async function showInbox(){if(!currentUser())return showAuth();const {data,error}=await db.from('conversations').select('id,requester_id,created_at,listings(title,owner_id)').order('created_at',{ascending:false});if(error)throw error;openModal(`<h2>My messages</h2>${data?.length?data.map(c=>`<button class="auth-btn" data-thread="${c.id}">💬 ${esc(c.listings?.title||'Item')} · ${humanAge(c.created_at)}</button>`).join(''):'<p class="sub">No conversations yet. Browse items and contact an owner.</p>'}`,true)}
async function showMyListings(){
 if(!currentUser())return showAuth();
 const {data,error}=await db.from('listings').select('id,listing_type,title,status,moderation_status,suburb,created_at')
  .eq('owner_id',currentUser().id).order('created_at',{ascending:false});
 if(error)throw error;
 const rows=(data||[]).map(x=>{
  const editable=x.status!=='removed'&&x.moderation_status!=='hidden';
  const label=x.moderation_status==='pending'?'Awaiting admin approval':x.moderation_status==='rejected'?'Rejected':x.moderation_status==='hidden'?'Deleted / hidden':x.status;
  const buttons=editable
   ?'<button class="btn btn-soft" data-edit-listing="'+x.id+'">✏️ Edit / resubmit</button> <button class="btn btn-ghost" data-manage="'+x.id+'" data-next="'+(x.status==='available'?'reserved':'available')+'">Mark '+(x.status==='available'?'reserved':'available')+'</button> <button class="btn btn-ghost" data-manage="'+x.id+'" data-next="collected">'+(x.listing_type==='want'?'Fulfilled':'Collected')+'</button> <button class="btn btn-ghost" data-manage="'+x.id+'" data-next="removed">Remove</button>'
   :'';
  return '<div class="thread"><strong>'+esc(x.title)+'</strong> <small>· '+(x.listing_type==='want'?'🔎 Wanted request':'🎁 Giveaway')+' · '+esc(label)+'</small><p class="muted">'+esc(x.suburb)+' · '+humanAge(x.created_at)+'</p><div class="admin-actions">'+buttons+'</div></div>';
 }).join('');
 openModal('<h2>My items & wanted requests</h2><p class="sub">Editing a listing or changing photos sends it back for admin approval before it becomes public again.</p><button class="btn" data-action="newPost">＋ Create a post</button>'+ (rows||'<p class="sub">You have no posts yet.</p>'),true);
}
async function showEditListing(id){
 if(!currentUser())return showAuth();
 if(accountBanned)throw new Error('This account is banned from editing.');
 const {data:l,error}=await db.from('listings')
  .select('id,listing_type,title,description,category_id,item_condition,suburb,state,postcode,status,moderation_status')
  .eq('id',id).eq('owner_id',currentUser().id).single();
 if(error)throw error;
 if(l.status==='removed'||l.moderation_status==='hidden')throw new Error('This post cannot be edited.');
 const {data:photos,error:photoError}=await db.from('listing_images')
  .select('storage_path,display_order').eq('listing_id',id).order('display_order');
 if(photoError)throw photoError;
 const categoryOptions=categories.map(c=>'<option value="'+c.id+'" '+(String(c.id)===String(l.category_id)?'selected':'')+'>'+esc(c.name)+'</option>').join('');
 const conditions=[['good','Good / usable'],['new','New'],['fair','Fair'],['for_parts','For parts']]
  .map(([value,label])=>'<option value="'+value+'" '+(l.item_condition===value?'selected':'')+'>'+label+'</option>').join('');
 const states=['QLD','NSW','VIC','WA','SA','ACT','TAS','NT']
  .map(state=>'<option '+(l.state===state?'selected':'')+'>'+state+'</option>').join('');
 const previews=(photos||[]).map(photo=>'<img loading="lazy" src="'+esc(photoUrl(photo))+'" alt="Current photo">').join('');
 openModal('<h2>Edit item / wanted request</h2><p class="not-available"><strong>Approval required.</strong> Saving edits hides your post until an administrator reviews the changes.</p>'+
 '<form id="editListingForm" data-id="'+l.id+'">'+
 '<div class="field"><label>Post type</label><select name="listing_type"><option value="have" '+(l.listing_type==='have'?'selected':'')+'>🎁 I have this — free item</option><option value="want" '+(l.listing_type==='want'?'selected':'')+'>🔎 I want this — request</option></select></div>'+
 '<div class="field"><label>Title</label><input name="title" maxlength="150" minlength="3" value="'+esc(l.title)+'" required></div>'+
 '<div class="field"><label>Category</label><select name="category">'+categoryOptions+'</select></div>'+
 '<div class="field" data-item-condition><label>Condition</label><select name="condition">'+conditions+'</select></div>'+
 '<div class="field"><label>Suburb</label><input name="suburb" maxlength="100" value="'+esc(l.suburb)+'" required></div>'+
 '<div class="field"><label>State / territory</label><select name="state">'+states+'</select></div>'+
 '<div class="field"><label>Postcode (optional)</label><input name="postcode" pattern="[0-9]{4}" maxlength="4" value="'+esc(l.postcode||'')+'"></div>'+
 '<div class="field"><label>Description</label><textarea name="description" maxlength="5000" rows="5" required>'+esc(l.description||'')+'</textarea></div>'+
 (previews?'<p class="muted">Existing photos:</p><div class="photos-row">'+previews+'</div>':'')+
 '<div class="field"><label>Replace photos (optional)</label><input name="photos" type="file" accept="image/jpeg,image/png,image/webp" multiple><small class="filehint">Choose up to 5 new photos to replace the old ones, or leave empty to keep them.</small></div>'+
 '<button type="submit" class="btn full">Save and send for admin approval →</button></form>',true);updateActivityCategoryForm(q('editListingForm'));
}
async function saveEditedListing(form){
 const user=currentUser();if(!user)return showAuth();
 if(accountBanned)throw new Error('This account cannot edit.');
 const id=form.dataset.id,f=new FormData(form),listing_type=f.get('listing_type');
 if(!['have','want'].includes(listing_type))throw new Error('Choose a valid post type.');
 const title=safe(f.get('title')),description=safe(f.get('description'));
 if(moneyRe.test(title+' '+description))throw new Error('No payments or fees are allowed.');
 const files=[...(form.elements.photos.files||[])];
 if(files.length>5)throw new Error('Choose at most 5 photos.');
 for(const file of files)if(file.size>8*1024*1024||!['image/jpeg','image/png','image/webp'].includes(file.type))
  throw new Error('Photos must be JPG, PNG or WebP under 8 MB.');
 const {data,error}=await db.from('listings').update({
   listing_type,category_id:Number(f.get('category')),title,description,
   item_condition:f.get('condition'),suburb:safe(f.get('suburb')),state:f.get('state'),
   postcode:safe(f.get('postcode'))||null,status:'available',moderation_status:'pending'
 }).eq('id',id).eq('owner_id',user.id).select('id,moderation_status').single();
 if(error)throw error;
 if(data.moderation_status!=='pending')throw new Error('Listing did not return to approval.');
 let failed=0;
 if(files.length){
  const previous=await db.from('listing_images').select('id,storage_path').eq('listing_id',id);
  if(previous.error)throw previous.error;
  const removed=await db.from('listing_images').delete().eq('listing_id',id);
  if(removed.error)throw removed.error;
  if(previous.data?.length){
   const cleaned=await db.storage.from(BUCKET).remove(previous.data.map(p=>p.storage_path));
   if(cleaned.error)console.warn('Old photo storage cleanup',cleaned.error);
  }
  for(const [i,file] of files.entries()){
   const ext=({'image/jpeg':'jpg','image/png':'png','image/webp':'webp'})[file.type];
   const storagePath=user.id+'/'+id+'/'+crypto.randomUUID()+'.'+ext;
   const uploaded=await db.storage.from(BUCKET).upload(storagePath,file,{contentType:file.type,upsert:false});
   if(uploaded.error){failed++;continue;}
   const inserted=await db.from('listing_images').insert({listing_id:id,storage_path:storagePath,display_order:i});
   if(inserted.error)failed++;
  }
 }
 closeModal();
 toast(failed?'Changes sent for approval; '+failed+' photo(s) could not be saved.':'Changes are pending admin approval; they are not public.');
 await fetchListings();if(adminAccess)await checkAdminAlerts().catch(console.warn);
}
async function showFavorites(){if(!currentUser())return showAuth();await loadFavorites();const arr=listings.filter(x=>favorites.has(x.id));openModal(`<h2>Saved free items</h2>${arr.length?arr.map(x=>`<button class="auth-btn" data-detail="${x.id}">♡ ${esc(x.title)} — ${esc(x.suburb)}</button>`).join(''):'<p class="sub">No saved items yet. Tap the ♡ on any listing.</p>'}`,true)}
async function toggleFavorite(id){if(!currentUser())return showAuth();if(favorites.has(id)){const {error}=await db.from('favorites').delete().eq('user_id',currentUser().id).eq('listing_id',id);if(error)throw error;favorites.delete(id)}else{const {error}=await db.from('favorites').insert({user_id:currentUser().id,listing_id:id});if(error)throw error;favorites.add(id)}drawListings()}
async function reportListing(id){if(!currentUser())return showAuth();openModal(`<h2>Report a listing</h2><p class="sub">Tell us what looks wrong. Reports are private.</p><form id="reportForm" data-id="${id}"><div class="field"><label>Reason</label><select name="reason"><option value="not_free">Asks for payment or a fee</option><option value="prohibited">Prohibited item</option><option value="scam">Suspected scam</option><option value="spam">Spam</option><option value="other">Other</option></select></div><div class="field"><label>Additional details</label><textarea name="details" maxlength="2000"></textarea></div><button class="btn full" type="submit">Send report</button></form>`)}
async function postReport(form){const f=new FormData(form);const {error}=await db.from('reports').insert({listing_id:form.dataset.id,reporter_id:currentUser().id,reason:f.get('reason'),details:safe(f.get('details'))});if(error)throw error;closeModal();toast('Your report has been received. Thank you.')}
async function updateHeader(){
 const check=++identitySerial;
 const user=currentUser();
 let verifiedAdmin=false,verifiedBan=false;
 if(user){
   const {data,error}=await db.rpc('zds_my_moderation_status');
   if(error){console.warn('Administrator verification temporarily unavailable',error);}
   else {verifiedAdmin=!!data?.admin;verifiedBan=!!data?.banned;}
 }
 if(check!==identitySerial || currentUser()?.id!==user?.id)return;
 adminAccess=verifiedAdmin;accountBanned=verifiedBan;
 const account=q('loginTop');
 account.textContent=!user?'Log in':adminAccess?'🛡️ Admin account':'My account';
 account.classList.toggle('admin-user',adminAccess);
 account.title=user?(adminAccess?'Administrator: ':'Signed in: ')+(user.email||'member'):'Log in';
 const bell=q('adminBell');if(bell)bell.hidden=!adminAccess;
 const workspace=q('adminWorkspace');if(workspace)workspace.hidden=!adminAccess;
 if(adminAccess){
   if(q('adminWorkspaceIdentity'))q('adminWorkspaceIdentity').textContent='Administrator signed in: '+(user.email||'member')+'. Access stays active until you log out.';
 }else adminSeenNotices=null;
 if(user)await loadFavorites();else favorites.clear();
 if(check!==identitySerial)return;
 ['postTop','heroPost','pointsPost','wantedPost'].forEach(id=>{const button=q(id);if(button){button.disabled=accountBanned;button.title=accountBanned?'Account banned from posting':'';}});
 drawListings();
 if(q('adminPageContent')){if(adminAccess)await showAdminPanel(adminFilter).catch(onError);else q('adminPageContent').innerHTML='<div class="page-note"><strong>Administrator sign-in required.</strong> Use Log in at the top of the page with an authorised administrator account.</div>';}
 if(adminAccess)await checkAdminAlerts().catch(console.warn);
 // Deep link from the single daily email: authenticate, then show the protected queue.
 if(pendingApprovalEmailLink){
   if(user&&adminAccess){
     pendingApprovalEmailLink=false;
     const cleanUrl=new URL(location.href);
     cleanUrl.searchParams.delete('review');
     history.replaceState(null,'',cleanUrl.pathname+cleanUrl.search+cleanUrl.hash);
     await showAdminPanel('pending').catch(onError);
   }else if(!user){
     if(!q('modalOverlay').classList.contains('show')){
       showAuth();
       authFeedback('Sign in with your administrator account to review pending items.');
     }
   }else{
     pendingApprovalEmailLink=false;
     toast('This review link is only available to approved administrators.');
   }
 }
}
function showNavigation(){openModal(`<h2>Explore Zero Dollar Store</h2><p><a href="index.html">🏠 Home</a></p><p><a href="browse.html">🎁 Browse free items</a></p><p><a href="wanted.html">🔎 I Need This — requests</a></p><p><a href="how-it-works.html">📦 How it works</a></p><p><a href="points.html">⭐ Zero Dollar Points</a></p><p><a href="safety.html">🛡️ Safety</a></p><p><a href="about.html">💚 About and funding</a></p><p><a href="newsletter.html">✉️ Newsletter</a></p>${adminAccess?'<button class="btn full" data-action="adminPanel">🛡️ Administrator moderation</button>':''}<button class="btn full" data-action="account">My account / Log in</button>`)}


async function checkAdminAlerts(){
 if(!adminAccess||!currentUser()||adminChecking)return;
 adminChecking=true;
 try{
  const [pending,alerts]=await Promise.all([
   db.rpc('zds_admin_listings',{p_filter:'pending'}),
   db.rpc('zds_admin_notices',{p_limit:80})
  ]);
  if(pending.error)throw pending.error;if(alerts.error)throw alerts.error;
  const count=(pending.data||[]).length;
  q('adminPendingCount').textContent=String(count);
  q('adminBell').title=count+' listings awaiting review';
  const recent=(alerts.data||[]).filter(e=>e.event_type==='posted'||e.event_type==='edited');
  const news=adminSeenNotices===null?[]:recent.filter(e=>!adminSeenNotices.has(e.event_id));
  adminSeenNotices=new Set(recent.map(e=>e.event_id));
  if(news.length){
    toast(news.length+' new item(s) awaiting approval');
    if('Notification' in window && Notification.permission==='granted')
      new Notification('Zero Dollar Store: new listing', {
        body:news.slice(0,3).map(e=>e.listing_title||'Free item').join(', '),tag:'zds-new-listings'
      });
  }
 }finally{adminChecking=false}
}
function showAdminEmailDraft(draft){
 currentEmailDraft=draft;
 if(!draft?.to)return toast('Action saved. Email address unavailable.');
 openModal('<h2>Moderation action completed</h2><p class="sub">An explanation for <strong>'+
 esc(draft.to)+'</strong> is ready.</p>'+
 '<p class="not-available"><strong>Not emailed yet.</strong> Use the email button to open your email app and send this message. Automatic email delivery needs configuration.</p>'+
 '<p><strong>Subject:</strong> '+esc(draft.subject)+'</p><div class="email-preview">'+esc(draft.body)+'</div>'+
 '<div class="admin-actions"><button class="btn" data-open-email-draft>✉️ Open email draft</button>'+
 '<button class="btn btn-ghost" data-copy-email-draft>Copy email</button>'+
 '<button class="btn btn-ghost" data-admin-return>Back to moderation</button></div>',true);
}
function openAdminEmail(){
 const d=currentEmailDraft;if(!d?.to)return;
 window.location.href='mailto:'+encodeURIComponent(d.to)+'?subject='+encodeURIComponent(d.subject)+'&body='+encodeURIComponent(d.body);
}

async function showAdminPanel(filter=adminFilter){
 const host=q('adminPageContent');
 if(!currentUser()||!adminAccess){
  if(host)host.innerHTML='<div class="page-note"><strong>Administrator sign-in required.</strong> Use Log in at the top of the page with an authorised administrator account.</div>';
  else location.href='admin.html?section='+encodeURIComponent(adminSection)+'&filter='+encodeURIComponent(filter);
  return;
 }
 if(!host){location.href='admin.html?section='+encodeURIComponent(adminSection)+'&filter='+encodeURIComponent(filter);return;}
 adminFilter=['pending','approved','rejected','hidden','all'].includes(filter)?filter:'pending';
 const titles={listings:'Listing moderation',requests:'Wanted requests',bans:'Banned accounts',reports:'Member reports'};
 const pageTitle=titles[adminSection]||titles.listings;
 const pageHeading=q('adminTitle');
 if(pageHeading)pageHeading.textContent=pageTitle;
 document.title=pageTitle+' | Zero Dollar Store admin';
 document.querySelectorAll('[data-admin-section]').forEach(link=>{
  const active=link.dataset.adminSection===adminSection;
  link.setAttribute('aria-current',active?'page':'false');
  link.classList.toggle('btn-dark',active);
  link.classList.toggle('btn-ghost',!active);
 });
 const sectionCopy={
  listings:'Review free item listings and update their moderation status.',
  requests:'Review member requests for free items and services.',
  bans:'Review banned accounts and download the private ban history.',
  reports:'Review reports submitted by members about listings.'
 };
 let body='';
 if(adminSection==='reports'){
  const {data:reports,error}=await db.rpc('zds_admin_reports');
  if(error)throw error;
  const cards=(reports||[]).map(report=>{
   return '<article class="admin-record"><div class="admin-record-head"><strong>'+esc(report.reason.replaceAll('_',' '))+'</strong><span class="admin-status">'+esc(report.status)+'</span></div>'
    +'<p class="muted">'+(report.listing_title?'Listing: '+esc(report.listing_title)+' · '+esc(report.listing_status):'Listing unavailable or removed')+' · Reported '+esc(new Date(report.created_at).toLocaleString('en-AU'))+'</p>'
    +(report.details?'<p style="white-space:pre-wrap">'+esc(report.details)+'</p>':'<p class="muted">No extra details were provided.</p>')
    +'</article>';
  }).join('');
  body='<p class="muted">'+(reports||[]).length+' report(s), newest first. Reports are visible to administrators only.</p>'
   +(cards||'<div class="page-note">No member reports have been submitted.</div>');
 }else if(adminSection==='bans'){
  const {data:bannedUsers,error}=await db.rpc('zds_admin_banned_users');
  if(error)throw error;
  body='<p class="muted">'+(bannedUsers||[]).length+' banned account(s). This private information is only shown to authorised administrators.</p>'
   +'<div class="admin-actions admin-export-row"><button type="button" class="btn btn-soft" data-export-bans="active">↓ Export active bans (CSV)</button><button type="button" class="btn btn-ghost" data-export-bans="all">↓ Export full ban history (CSV)</button></div>'
   +'<div class="admin-ban-list">'+((bannedUsers||[]).length?(bannedUsers||[]).map(user=>'<article class="admin-record"><strong>'+esc(user.email)+'</strong><button type="button" class="btn btn-ghost" data-ban-user="'+esc(user.user_id)+'" data-ban-state="false">Unban email</button></article>').join(''):'<div class="page-note">No banned accounts currently.</div>')+'</div>';
 }else{
  const {data,error}=await db.rpc('zds_admin_listings',{p_filter:adminFilter});
  if(error)throw error;
  const entries=data||[];
  const ids=entries.map(item=>item.id),pics={},types={};
  const bannedResult=await db.rpc('zds_admin_banned_users');
  if(bannedResult.error)throw bannedResult.error;
  const bannedUsers=bannedResult.data||[];
  if(ids.length){
   const {data:kinds,error:kindsError}=await db.from('listings').select('id,listing_type').in('id',ids);
   if(kindsError)throw kindsError;
   (kinds||[]).forEach(item=>types[item.id]=item.listing_type);
   const {data:photos,error:photoError}=await db.from('listing_images').select('listing_id,storage_path,display_order').in('listing_id',ids).order('display_order');
   if(photoError)throw photoError;
   (photos||[]).forEach(item=>(pics[item.listing_id]??=[]).push(item));
  }
  const requests=adminSection==='requests';
  const visibleEntries=entries.filter(item=>(types[item.id]==='want')===requests);
  const filters=[['pending','Pending review'],['approved','Approved'],['rejected','Rejected'],['hidden','Deleted / hidden'],['all','All']];
  const filterNav=filters.map(([value,label])=>'<a class="btn '+(adminFilter===value?'':'btn-ghost')+'" data-admin-filter="'+value+'" href="admin.html?section='+adminSection+'&amp;filter='+value+'">'+label+'</a>').join('');
  const rows=visibleEntries.map(item=>{
   const photos=(pics[item.id]||[]).slice(0,5).map(photo=>'<img loading="lazy" style="width:72px;height:64px;object-fit:cover;border-radius:8px;border:1px solid #e5e7eb" src="'+esc(photoUrl(photo))+'" alt="Listing photo">').join('');
   const banned=bannedUsers.some(user=>user.user_id===item.owner_id);
   return '<article class="admin-record"><strong>'+esc(item.title)+'</strong> <span class="muted">· '+(requests?'🔎 Wanted request':'🎁 Free item')+' · '+esc(item.moderation_status)+' · '+esc(item.status)+'</span>'
    +'<p class="muted">Posted by '+esc(item.owner_email||item.owner_id)+' · '+humanAge(item.created_at)+' · '+esc(item.suburb)+', '+esc(item.state)+'</p>'
    +'<div style="display:flex;flex-wrap:wrap;gap:6px;margin:8px 0">'+photos+'</div><p style="white-space:pre-wrap;font-size:13px">'+esc(item.description)+'</p>'
    +'<div class="admin-actions">'
    +(item.moderation_status!=='approved'&&item.status!=='removed'&&!banned?'<button class="btn" data-moderate="approve" data-target="'+esc(item.id)+'">✓ Approve &amp; publish</button>':'')
    +(item.moderation_status==='pending'?'<button class="btn btn-ghost" data-moderate="reject" data-target="'+esc(item.id)+'">Reject with reason</button>':'')
    +(item.moderation_status!=='hidden'||item.status!=='removed'?'<button class="btn btn-ghost" data-moderate="delete" data-target="'+esc(item.id)+'">Delete listing</button>':'')
    +(!banned?'<button class="btn btn-ghost" data-ban-user="'+esc(item.owner_id)+'" data-ban-state="true" data-ban-email="'+esc(item.owner_email||'member')+'">Ban account &amp; email</button>':'')
    +'</div></article>';
  }).join('');
  body='<nav class="admin-filter-nav" aria-label="Filter '+(requests?'requests':'listings')+'">'+filterNav+'</nav>'
   +'<p class="muted">'+visibleEntries.length+' '+(requests?'request(s)':'listing(s)')+' in this view</p>'
   +(rows||'<div class="page-note">No '+(requests?'requests':'listings')+' in this view.</div>');
 }
 host.innerHTML='<section class="admin-page-panel"><div class="admin-panel-heading"><div><p class="kicker">ADMIN WORKSPACE</p><h2>'+pageTitle+'</h2><p>'+sectionCopy[adminSection]+'</p></div><button type="button" class="btn btn-soft" data-enable-admin-notifications>🔔 Enable alerts</button></div>'+body+'</section>';
}

function encodeCsvValue(input){
 let value=String(input??'');
 // Neutralise spreadsheet formulas before the CSV is opened in Excel or similar tools.
 if(/^\s*[=+\-@]/.test(value) || /^[\t\r\n]/.test(value))value="'"+value;
 return '"'+value.replace(/"/g,'""')+'"';
}
async function exportBanReport(scope='active'){
 if(!adminAccess||!currentUser())return toast('Administrator access required.');
 if(!['active','all'].includes(scope))throw new Error('Invalid report filter.');
 const pageSize=500;
 let items=[];
 for(let offset=0;offset<100000;offset+=pageSize){
  const {data,error}=await db.rpc('zds_admin_export_ban_report',{p_status:scope,p_offset:offset,p_limit:pageSize});
  if(error)throw error;
  items.push(...(data||[]));
  if((data||[]).length<pageSize)break;
 }
 const header=['Email','User ID','Ban reason','Banned by','Date banned (UTC)','Status','Date unbanned (UTC)'];
 const lines=[header,...items.map(x=>[x.email,x.user_id,x.reason,x.banned_by,x.banned_at,x.ban_status,x.lifted_at])];
 const csv='\uFEFF'+lines.map(row=>row.map(encodeCsvValue).join(',')).join('\r\n')+'\r\n';
 const file=new Blob([csv],{type:'text/csv;charset=utf-8'});
 const url=URL.createObjectURL(file);
 try{
  const link=document.createElement('a');
  link.href=url;
  link.download='zero-dollar-store-banned-users-'+scope+'-'+new Date().toISOString().slice(0,10)+'.csv';
  document.body.appendChild(link);
  link.click();
  link.remove();
 }finally{setTimeout(()=>URL.revokeObjectURL(url),3000)}
 toast('Ban report prepared: '+items.length+' record(s).');
}
async function adminModerate(id,action){
 if(!adminAccess)return toast('Admin access required');
 let reason='';
 if(action!=='approve'){
  const answer=window.prompt(action==='delete'?'Why is this listing being deleted?':'Why is this listing being rejected?','');
  if(answer===null)return;
  reason=answer.trim();
  if(reason.length<5)return toast('Please enter a reason of at least 5 characters.');
  if(!window.confirm('Confirm '+(action==='delete'?'deletion':'rejection')+'?'))return;
 }
 const {data,error}=await db.rpc('zds_admin_review_listing',{p_listing:id,p_decision:action,p_reason:reason});
 if(error)throw error;
 await fetchListings();
 await checkAdminAlerts().catch(console.warn);
 if(data?.email_draft)showAdminEmailDraft(data.email_draft);
 else {toast('Listing approved and published.');await showAdminPanel('pending');}
}
async function adminSetBan(id,banned,email='this member'){
 if(!adminAccess)return toast('Admin access required');
 if(banned){
  const answer=window.prompt('Explain why '+email+' is being banned. This goes in their email.','');
  if(answer===null)return;
  const reason=answer.trim();
  if(reason.length<5)return toast('Please provide a reason of at least 5 characters.');
  if(!window.confirm('Ban '+email+' and block this EMAIL address? Their listings will disappear.'))return;
  const {data,error}=await db.rpc('zds_admin_ban_member',{p_member:id,p_reason:reason});
  if(error)throw error;
  await fetchListings();
  await checkAdminAlerts().catch(console.warn);
  if(data?.email_draft)showAdminEmailDraft(data.email_draft);
 }else{
  if(!window.confirm('Unban this member AND their email?'))return;
  const {error}=await db.rpc('zds_admin_set_ban',{p_user:id,p_banned:false});
  if(error)throw error;
  toast('Account and email unbanned. Removed posts remain hidden.');
  await showAdminPanel('pending');
 }
}

function onError(e){console.error(e);toast(e?.message||'Something went wrong. Please try again.');}

q('itemsGrid')?.addEventListener('click',e=>{
 const remove=e.target.closest('[data-admin-delete]');if(remove){e.stopPropagation();if(!adminAccess)return;return adminModerate(remove.dataset.adminDelete,'delete').catch(onError);}
 const favorite=e.target.closest('[data-save]');if(favorite){e.stopPropagation();return toggleFavorite(favorite.dataset.save).catch(onError);}
 const post=e.target.closest('[data-post]');if(post)return showPost(post.dataset.post||'have');
 const item=e.target.closest('[data-item]');if(item)showItem(item.dataset.item);
});
q('itemsGrid')?.addEventListener('keydown',e=>{if((e.key==='Enter'||e.key===' ')&&e.target.matches('[data-item]')){e.preventDefault();showItem(e.target.dataset.item)}});
q('searchForm')?.addEventListener('submit',e=>{e.preventDefault();searchTerm=safe(q('searchText').value);searchArea=safe(q('searchArea').value);drawListings();q('browse').scrollIntoView({behavior:'smooth'})});
q('sortBy')?.addEventListener('change',drawListings);q('resetButton')?.addEventListener('click',()=>{selectedCategory='all';searchTerm='';searchArea='';q('searchText').value='';q('searchArea').value='';drawCategories();drawListings();q('browse').scrollIntoView({behavior:'smooth'})});
q('adminBell')?.addEventListener('click',()=>{location.href='admin.html?section=listings'});
q('adminWorkspaceButton')?.addEventListener('click',()=>{location.href='admin.html?section=listings'});
q('wantedPost')?.addEventListener('click',()=>showPost('want'));
q('wantedBrowse')?.addEventListener('click',()=>{listingView='want';selectedCategory='all';searchTerm='';searchArea='';q('searchText').value='';q('searchArea').value='';drawCategories();drawListings();q('browse').scrollIntoView({behavior:'smooth'});});
document.querySelectorAll('[data-listing-view]').forEach(button=>button.addEventListener('click',()=>{
 listingView=button.dataset.listingView;selectedCategory='all';searchTerm='';searchArea='';q('searchText').value='';q('searchArea').value='';drawCategories();drawListings();
}));q('postTop')?.addEventListener('click',showPost);q('heroPost')?.addEventListener('click',showPost);q('pointsPost')?.addEventListener('click',showPost);q('loginTop')?.addEventListener('click',()=>currentUser()?showAccount().catch(onError):showAuth());q('footerSignIn')?.addEventListener('click',e=>{e.preventDefault();currentUser()?showAccount().catch(onError):showAuth()});q('mobileMenu')?.addEventListener('click',showNavigation);
q('advertiseButton')?.addEventListener('click',()=>openModal(`<h2>Advertise with Zero Dollar Store 📣</h2><p class="sub">Zero Dollar Store is operated and funded by Ground Support Crew, a Brisbane-based business. The marketplace is free for everyone to use.</p><p>Our plan is to help cover running costs through clearly labelled website advertising, sponsored placements and optional newsletter sponsorships. Ground Support Crew currently pays the operating costs.</p><p>Advertising enquiries will be enabled before launch.</p>`));
q('newsletterForm')?.addEventListener('submit',e=>{e.preventDefault();if(!q('newsletterConsent').checked)return toast('Please tick the consent box to subscribe.');if(!currentUser())return showAuth();if(safe(q('newsletterEmail').value).toLowerCase()!==safe(currentUser().email).toLowerCase())return toast('Use the email address associated with your account.');setNewsletter(true).then(()=>{q('newsletterEmail').value='';q('newsletterConsent').checked=false}).catch(onError)});
q('adminPageContent')?.addEventListener('click',e=>{
 const mod=e.target.closest('[data-moderate]');if(mod)return adminModerate(mod.dataset.target,mod.dataset.moderate).catch(onError);
 const ban=e.target.closest('[data-ban-user]');if(ban)return adminSetBan(ban.dataset.banUser,ban.dataset.banState==='true',ban.dataset.banEmail).catch(onError);
 const exportBans=e.target.closest('[data-export-bans]');if(exportBans)return exportBanReport(exportBans.dataset.exportBans).catch(onError);
 if(e.target.closest('[data-enable-admin-notifications]')){
  if(!('Notification' in window))return toast('Notifications are unsupported in this browser.');
  return Notification.requestPermission().then(p=>toast(p==='granted'?'Notifications enabled while site is open.':'Notification permission was not granted.'));
 }
});
q('modalOverlay')?.addEventListener('click',e=>{if(e.target===q('modalOverlay')||e.target.closest('[data-close]'))return closeModal();

 if(e.target.closest('[data-open-email-draft]'))return openAdminEmail();
 if(e.target.closest('[data-copy-email-draft]')){
  const d=currentEmailDraft;if(d&&navigator.clipboard)
   return navigator.clipboard.writeText('To: '+d.to+'\nSubject: '+d.subject+'\n\n'+d.body).then(()=>toast('Email copied; you still need to send it.')).catch(onError);
 }
 const exportBans=e.target.closest('[data-export-bans]');if(exportBans)return exportBanReport(exportBans.dataset.exportBans).catch(onError);
 if(e.target.closest('[data-admin-return]'))return showAdminPanel('pending').catch(onError);
 if(e.target.closest('[data-enable-admin-notifications]')){
  if(!('Notification' in window))return toast('Notifications are unsupported in this browser.');
  return Notification.requestPermission().then(p=>toast(p==='granted'?'Notifications enabled while site is open.':'Notification permission was not granted.'));
 }
 const filter=e.target.closest('[data-admin-filter]');if(filter)return showAdminPanel(filter.dataset.adminFilter).catch(onError);
 const mod=e.target.closest('[data-moderate]');if(mod)return adminModerate(mod.dataset.target,mod.dataset.moderate).catch(onError);
 const ban=e.target.closest('[data-ban-user]');if(ban)return adminSetBan(ban.dataset.banUser,ban.dataset.banState==='true',ban.dataset.banEmail).catch(onError);const auth=e.target.closest('[data-oauth]');if(auth)return doOAuth(auth.dataset.oauth).catch(onError);const helper=e.target.closest('[data-auth-action]');if(helper)return handleAuthHelp(helper.dataset.authAction).catch(onError);const contact=e.target.closest('[data-contact]');if(contact)return contactOwner(contact.dataset.contact).catch(onError);const status=e.target.closest('[data-status]');if(status)return setStatus(status.dataset.id,status.dataset.status).catch(onError);
 const adminDelete=e.target.closest('[data-admin-delete]');if(adminDelete)return adminModerate(adminDelete.dataset.adminDelete,'delete').catch(onError);
 const edit=e.target.closest('[data-edit-listing]');if(edit)return showEditListing(edit.dataset.editListing).catch(onError);const rep=e.target.closest('[data-report]');if(rep)return reportListing(rep.dataset.report).catch(onError);const thread=e.target.closest('[data-thread]');if(thread)return showThread(thread.dataset.thread).catch(onError);const detail=e.target.closest('[data-detail]');if(detail)return showItem(detail.dataset.detail);const manage=e.target.closest('[data-manage]');if(manage)return setStatus(manage.dataset.manage,manage.dataset.next).then(showMyListings).catch(onError);const navLink=e.target.closest('[data-nav-view]');if(navLink){listingView=navLink.dataset.navView;selectedCategory='all';drawCategories();drawListings();closeModal();if(q('browse'))q('browse').scrollIntoView({behavior:'smooth'});return;}if(e.target.closest('[data-nav]'))return closeModal();const action=e.target.closest('[data-action]')?.dataset.action;if(action==='account')return currentUser()?showAccount().catch(onError):showAuth();if(action==='logout')return db.auth.signOut().then(()=>{closeModal();toast('Signed out')}).catch(onError);if(action==='newPost')return showPost();if(action==='myListings')return showMyListings().catch(onError);if(action==='adminPanel')return showAdminPanel().catch(onError);if(action==='inbox')return showInbox().catch(onError);if(action==='favorites')return showFavorites().catch(onError);if(action==='saveNewsletter')return setNewsletter(q('accountNewsletter').checked).catch(onError)});
q('modalOverlay')?.addEventListener('change',e=>{if(e.target.matches('select[name="category"]'))updateActivityCategoryForm(e.target.closest('form'))});
q('modalOverlay')?.addEventListener('submit',e=>{e.preventDefault();const f=e.target;const submit=e.submitter;if(f.id==='authForm')return authenticate(submit?.dataset.mode||'login').catch(onError);if(f.id==='passwordRecoveryForm'){const pass=f.elements.password.value;return db.auth.updateUser({password:pass}).then(({error})=>{if(error)throw error;closeModal();toast('Password updated. You can now sign in.');}).catch(err=>{q('recoveryFeedback').textContent=String(err.message||err)})}if(f.id==='postForm'){const btn=f.querySelector('button[type=submit]');btn.disabled=true;return saveListing(f).catch(onError).finally(()=>btn.disabled=false)}
 if(f.id==='editListingForm'){const btn=f.querySelector('button[type=submit]');btn.disabled=true;return saveEditedListing(f).catch(onError).finally(()=>btn.disabled=false)}if(f.id==='sendMessage')return sendMessage(f).catch(onError);if(f.id==='reportForm')return postReport(f).catch(onError)});
document.addEventListener('keydown',e=>{if(e.key==='Escape')closeModal()});
setInterval(()=>{if(adminAccess&&currentUser())checkAdminAlerts().catch(console.warn)},30000);
db.auth.onAuthStateChange((event,s)=>{session=s;setTimeout(()=>updateHeader().catch(onError),0);if(event==='PASSWORD_RECOVERY')setTimeout(()=>showPasswordRecovery(),0)});
(async()=>{
 const params=new URLSearchParams(location.search);
 const fragment=new URLSearchParams(location.hash.replace(/^#/,'')); 
 const oauthError=params.get('error_description')||fragment.get('error_description')||params.get('error')||fragment.get('error');
 const {data,error}=await db.auth.getSession();
 if(error)toast('Sign-in session could not be restored: '+error.message);
 session=data?.session||null;
 await refresh();await updateHeader();
 if(oauthError){showAuth();authFeedback('The email sign-in link could not be used: '+oauthError.replace(/\+/g,' ')+'. If it is expired, enter your email and select Resend confirmation email.',true);}
})().catch(onError);
