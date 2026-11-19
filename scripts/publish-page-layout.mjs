import prisma from '../app/db.server.js';
import {publishPageLayout} from '../app/services/pageLayoutPublication.server.js';
// Publish existing presentation settings only. Never starts catalog/index jobs.
try {
  const rows=await prisma.filterGlobalSetting.findMany({select:{shop:true,integrations:true}});
  let failures=0;
  for(const row of rows){
    if(!row.integrations||!('collectionPageWidth' in row.integrations))continue;
    try { await publishPageLayout(row.shop,row,{force:true});console.log('PAGE_LAYOUT_PUBLISHED',row.shop); }
    catch { failures++;console.error('PAGE_LAYOUT_PUBLICATION_FAILED',row.shop); }
  }
  if(failures)process.exitCode=1;
}finally{await prisma.$disconnect();}
