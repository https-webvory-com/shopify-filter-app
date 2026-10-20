(function(){
  if(window.cfpReadEarlyResponse||typeof TextDecoder==='undefined')return;
  window.cfpReadEarlyResponse=async function(response,onProduct){
    if(response.status!==200||!response.headers?.get('Content-Type')?.startsWith('application/x-ndjson'))return {status:response.status,payload:await response.json()};
    const reader=response.body.getReader(),decoder=new TextDecoder(),products=[],seen=new Set();
    let buffer='',metadata,expected,ended=false;
    function line(text){
      if(text.length>2*1024*1024)throw Error('Collection stream record too large');
      if(!text.trim())return;
      if(ended)throw Error('Unexpected collection stream data');
      const record=JSON.parse(text);
      if(record.type==='start'){
        if(metadata||!Number.isInteger(record.count)||record.count<0||record.count>25||record.payload?.cfpCards?.version!==1||!['ready','prefix-ready'].includes(record.payload?.debug?.collectionRankingStatus)||record.payload?.debug?.collectionRankingStatus==='prefix-ready'&&record.payload?.cfpCards?.prefix!==true)throw Error('Invalid collection stream header');
        if(record.payload.debug.collectionRankingStatus==='prefix-ready'&&(record.count<1||record.payload.cfpCards.proof?.version!==2||!/^[a-f0-9]{64}$/.test(record.payload.cfpCards.proof?.inputVersion||'')||record.payload.rankingToken!=null||record.payload.totalCount!=null))throw Error('Invalid collection prefix proof');
        metadata=record.payload;expected=record.count;
      }else if(record.type==='product'){
        const product=record.product;
        if(!metadata||products.length>=expected||!product?.id||!product.title||!product.handle||seen.has(product.id))throw Error('Invalid collection stream product');
        seen.add(product.id);products.push(product);
        try{onProduct?.({status:200,payload:{...metadata,cfpCards:{...metadata.cfpCards,streaming:true},products:[...products]}});}catch{}
      }else if(record.type==='end'){
        if(!metadata||record.count!==expected||products.length!==expected)throw Error('Incomplete collection stream');
        ended=true;
      }else throw Error('Unknown collection stream record');
    }
    try{
      for(;;){
        const {value,done}=await reader.read();
        buffer+=decoder.decode(value||new Uint8Array(),{stream:!done});
        let newline;
        while((newline=buffer.indexOf('\n'))>=0){line(buffer.slice(0,newline));buffer=buffer.slice(newline+1);}
        if(buffer.length>2*1024*1024)throw Error('Collection stream record too large');
        if(done)break;
      }
      if(buffer.trim())line(buffer);
      if(!ended)throw Error('Incomplete collection stream');
      return {status:200,payload:{...metadata,products}};
    }catch(error){await reader.cancel().catch(()=>{});throw error;}
    finally{reader.releaseLock();}
  };
})();
