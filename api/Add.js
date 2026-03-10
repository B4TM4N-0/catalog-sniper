export default async function handler(req,res){
if(req.method!=="POST"){res.status(405).json({error:"method not allowed"});return;}
const {id,name}=req.body;
if(!id||!/^\d+$/.test(String(id))){res.status(400).json({error:"invalid id"});return;}
try{
const r=await fetch(process.env.SUPABASE_URL+"/rest/v1/user_emotes",{
method:"POST",
headers:{
"Content-Type":"application/json",
apikey:process.env.SUPABASE_SERVICE_KEY,
Authorization:`Bearer ${process.env.SUPABASE_SERVICE_KEY}`,
Prefer:"return=minimal"
},
body:JSON.stringify({id,name:name||"User Emote"})
});
if(r.status===409){
res.status(200).json({success:false,message:"emote already exists"});
return;
}
if(!r.ok){
const text=await r.text();
res.status(500).json({error:text});
return;
}
res.status(200).json({success:true,id});
}catch(e){
res.status(500).json({error:e.message});
}
}
