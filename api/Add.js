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
Authorization:`Bearer ${process.env.SUPABASE_SERVICE_KEY}`
},
body:JSON.stringify({id,name})
});
if(!r.ok){res.status(500).json({error:"insert failed"});return;}
res.status(200).json({success:true});
}catch(e){
res.status(500).json({error:e.message});
}
}
