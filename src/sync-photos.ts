import 'dotenv/config';
import schedule from 'node-schedule';
import fetch from 'node-fetch';
import * as qiniu from 'qiniu';
import { Agent } from 'https';

// 定义接口
interface QiniuConfig {
  accessKey: string;
  secretKey: string;
  bucket: string;
  zone: string;
  domain: string;
}

interface PhotoItem {
  id: string;
  filename: string;
}

interface NasResponse {
  data: {
    list: PhotoItem[];
  };
}

// 七牛云配置
const config: QiniuConfig = {
  accessKey: process.env.QINIU_ACCESS_KEY || '',
  secretKey: process.env.QINIU_SECRET_KEY || '',
  bucket: process.env.QINIU_BUCKET || '',
  zone: process.env.QINIU_ZONE || 'z0',
  domain: process.env.QINIU_DOMAIN || ''
};

// 创建自定义的https agent，忽略SSL证书验证
const agent = new Agent({
  rejectUnauthorized: false
});

// 初始化七牛云
const mac = new qiniu.auth.digest.Mac(config.accessKey, config.secretKey);

// 获取NAS照片列表
async function getNasPhotos(): Promise<PhotoItem[]> {
  try {
    const response = await fetch("https://127.0.0.1:5001/mo/sharing/webapi/entry.cgi/SYNO.Foto.Browse.Item", {
      headers: {
        "accept": "*/*",
        "content-type": "application/x-www-form-urlencoded; charset=UTF-8",
        "x-syno-sharing": "PjcdQ3TSc"
      },
      body: "api=SYNO.Foto.Browse.Item&method=list&version=1&additional=[\"thumbnail\",\"resolution\",\"orientation\",\"video_convert\",\"video_meta\",\"provider_user_id\"]&offset=0&limit=3&sort_by=\"takentime\"&sort_direction=\"asc\"&passphrase=\"PjcdQ3TSc\"",
      method: "POST",
      agent
    });

    const data = await response.json() as NasResponse;
    return data.data.list || [];
  } catch (error) {
    console.error('获取NAS照片列表失败:', error);
    return [];
  }
}

// 上传单个文件到七牛云
function uploadToQiniu(fileUrl: string, key: string): Promise<unknown> {
  const qiniuConfig = new qiniu.conf.Config();
  const bucketManager = new qiniu.rs.BucketManager(mac, qiniuConfig);
  
  return new Promise((resolve, reject) => {
    bucketManager.fetch(fileUrl, config.bucket, key, (err, respBody, respInfo) => {
      if (err) {
        reject(err);
      } else if (respInfo.statusCode === 200) {
        resolve(respBody);
      } else {
        reject(new Error(`上传失败: ${respInfo.statusCode}`));
      }
    });
  });
}

// 生成图片URL
function generatePhotoUrl(photoId: string): string {
  return `https://127.0.0.1:5001/mo/sharing/webapi/entry.cgi?id=${photoId}&cache_key="${photoId}_${Date.now()}"&type="unit"&size="sm"&passphrase="PjcdQ3TSc"&api="SYNO.Foto.Thumbnail"&method="get"&version=2&_sharing_id="PjcdQ3TSc"`;
}

// 同步任务
async function syncPhotos(): Promise<void> {
  try {
    console.log('开始同步照片...');
    const photos = await getNasPhotos();
    
    for (const photo of photos) {
      const fileUrl = generatePhotoUrl(photo.id);
      const key = `nas-photos/${photo.filename}`;
      
      try {
        await uploadToQiniu(fileUrl, key);
        console.log(`成功上传: ${photo.filename}`);
      } catch (error) {
        console.error(`上传失败 ${photo.filename}:`, error);
      }
    }
    
    console.log('同步完成');
  } catch (error) {
    console.error('同步过程出错:', error);
  }
}

// 设置定时任务 - 每天凌晨2点执行
schedule.scheduleJob('0 2 * * *', syncPhotos);

// 立即执行一次测试
syncPhotos(); 