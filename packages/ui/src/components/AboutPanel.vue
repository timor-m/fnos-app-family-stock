<script setup lang="ts">
import { onMounted, ref } from 'vue';
import { request } from '../utils/api';
import PageSkeleton from './PageSkeleton.vue';
import icon from '../assets/app-icon.png';
const about=ref<{appTitle:string;appDescription:string;appVersion:string;appName:string;maintainer:string;sourceUrl:string;osMinVersion:string;runtime:{node:string;platform:string;arch:string};database:{schemaVersion:number}}>();
const error=ref(''),pending=ref(true);
async function load(){pending.value=true;error.value='';try{about.value=await request('about');}catch(e){error.value=e instanceof Error?e.message:'应用信息加载失败';}finally{pending.value=false;}}
onMounted(load);
</script>
<template>
  <div class="about-page">
    <PageSkeleton v-if="pending" />
    <p v-if="error" class="inline-error" role="alert">{{ error }}<button @click="load">重试</button></p>
    <template v-if="about">
      <div class="about-brand"><img :src="icon" alt="" /><h2>{{ about.appTitle }}</h2><p>{{ about.appDescription }}</p></div>
      <dl class="about-grid"><div><dt>应用版本</dt><dd>{{ about.appVersion }}</dd></div><div><dt>数据库版本</dt><dd>v{{ about.database.schemaVersion }}</dd></div><div><dt>Node.js</dt><dd>{{ about.runtime.node }}</dd></div><div><dt>平台与架构</dt><dd>{{ about.runtime.platform }} / {{ about.runtime.arch }}</dd></div></dl>
      <dl class="about-links"><div><dt>应用标识</dt><dd>{{ about.appName }}</dd></div><div><dt>维护者</dt><dd>{{ about.maintainer }}</dd></div><div><dt>最低飞牛版本</dt><dd>{{ about.osMinVersion }}</dd></div><div><dt>源代码</dt><dd><a :href="about.sourceUrl" target="_blank" rel="noreferrer">查看项目与更新记录 ↗</a></dd></div></dl>
    </template>
  </div>
</template>
<style scoped>
.about-brand {text-align:center;padding:10px 0 24px;} .about-brand img{width:72px;height:72px;object-fit:contain;} h2{font-size:20px;margin:10px 0;} p{color:var(--muted);font-size:13px;line-height:1.7;margin:0;} .about-grid{display:grid;grid-template-columns:repeat(2,minmax(0,1fr));gap:18px;border-block:1px solid var(--line);padding:20px 0;margin:0;} dt{font-size:12px;color:var(--muted);} dd{margin:6px 0 0;font-size:14px;overflow-wrap:anywhere;} .about-links{display:grid;gap:16px;margin:20px 0 0;} .about-links>div{display:grid;grid-template-columns:110px minmax(0,1fr);align-items:center;gap:10px;} .about-links dd{margin:0;} a{color:var(--green);}
</style>
