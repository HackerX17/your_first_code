// Rendering: renderer, physically based sky + lighting, post-processing chain and quality settings.
import * as THREE from 'three';
import { EffectComposer } from 'three/addons/postprocessing/EffectComposer.js';
import { RenderPass } from 'three/addons/postprocessing/RenderPass.js';
import { ShaderPass } from 'three/addons/postprocessing/ShaderPass.js';
import { UnrealBloomPass } from 'three/addons/postprocessing/UnrealBloomPass.js';
import { OutputPass } from 'three/addons/postprocessing/OutputPass.js';
import { SMAAPass } from 'three/addons/postprocessing/SMAAPass.js';
import { GTAOPass } from 'three/addons/postprocessing/GTAOPass.js';
import { Sky } from 'three/addons/objects/Sky.js';
import { settings, clamp } from './core.js';

// low golden-hour sun
export const SUN_DIR = new THREE.Vector3().setFromSphericalCoords(1, THREE.MathUtils.degToRad(90 - 13), THREE.MathUtils.degToRad(222)).normalize();

const GradeShader = {
  uniforms: { tDiffuse: { value: null }, uTime: { value: 0 }, uVignette: { value: 0.55 }, uSat: { value: 1.06 }, uContrast: { value: 1.06 },
    uDamage: { value: 0 }, uFlash: { value: 0 }, uGrain: { value: 0.035 }, uLowHP: { value: 0 }, uAberr: { value: 0 }, uSuppress: { value: 0 } },
  vertexShader: 'varying vec2 vUv; void main(){ vUv = uv; gl_Position = projectionMatrix * modelViewMatrix * vec4(position,1.0); }',
  fragmentShader: `uniform sampler2D tDiffuse; uniform float uTime,uVignette,uSat,uContrast,uDamage,uFlash,uGrain,uLowHP,uAberr,uSuppress; varying vec2 vUv;
  void main(){
    vec2 c = vUv - 0.5; float r = length(c);
    float ab = (0.0012 + uAberr * 0.006) * r;
    vec3 col = vec3(texture2D(tDiffuse, vUv + c * ab).r, texture2D(tDiffuse, vUv).g, texture2D(tDiffuse, vUv - c * ab).b);
    float l = dot(col, vec3(0.299, 0.587, 0.114));
    col = mix(vec3(l), col, uSat * (1.0 - 0.75 * uLowHP) * (1.0 - 0.35 * uSuppress));
    col = (col - 0.5) * uContrast + 0.5;
    col *= mix(vec3(1.0), vec3(1.035, 1.0, 0.95), 0.6);                       // warm highlights
    col = mix(col, col * vec3(0.92, 0.97, 1.06), smoothstep(0.35, 0.0, l));   // cool shadows
    float vig = smoothstep(0.92, 0.22, r * (1.0 + 0.35 * uSuppress + 0.3 * uLowHP));
    col *= mix(1.0, vig, uVignette + 0.25 * uSuppress);
    float edge = smoothstep(0.25, 0.75, r);
    col = mix(col, col * vec3(0.9, 0.12, 0.08), clamp(uDamage * edge * 1.2 + uLowHP * edge * 0.55, 0.0, 0.85));
    float n = fract(sin(dot(vUv * vec2(12.9898, 78.233) + fract(uTime) * 7.31, vec2(1.0, 1.0))) * 43758.5453);
    col += (n - 0.5) * uGrain;
    col = mix(col, vec3(1.0), clamp(uFlash, 0.0, 1.0));
    gl_FragColor = vec4(clamp(col, 0.0, 1.0), 1.0);
  }`
};

export class Renderer {
  constructor(container) {
    this.dynScale = 1; this.aoShed = false;
    const r = (this.r = new THREE.WebGLRenderer({ antialias: false, powerPreference: 'high-performance', stencil: false }));
    r.outputColorSpace = THREE.SRGBColorSpace; r.toneMapping = THREE.ACESFilmicToneMapping; r.toneMappingExposure = 1.0;
    r.shadowMap.enabled = true; r.shadowMap.type = THREE.PCFSoftShadowMap;
    container.appendChild(r.domElement);
    this.scene = new THREE.Scene();
    this.camera = new THREE.PerspectiveCamera(80, innerWidth / innerHeight, 0.05, 1600); this.camera.rotation.order = 'YXZ';
    this.vmScene = new THREE.Scene(); this.vmCam = new THREE.PerspectiveCamera(52, innerWidth / innerHeight, 0.01, 20);
    this._lights();
    const rt = new THREE.WebGLRenderTarget(1, 1, { type: THREE.HalfFloatType });
    this.composer = new EffectComposer(r, rt);
    this.worldPass = new RenderPass(this.scene, this.camera);
    this.gtao = new GTAOPass(this.scene, this.camera, 2, 2, undefined, { radius: 0.55, distanceExponent: 1.2, thickness: 1.2, scale: 1.25, samples: 12, distanceFallOff: 1 }, { lumaPhi: 10, depthPhi: 2, normalPhi: 3, radius: 5, rings: 2, samples: 12 });
    this.gtao.output = GTAOPass.OUTPUT.Default; this.gtao.blendIntensity = 1;
    this.vmPass = new RenderPass(this.vmScene, this.vmCam); this.vmPass.clear = false; this.vmPass.clearDepth = true;
    this.bloom = new UnrealBloomPass(new THREE.Vector2(256, 256), 0.32, 0.55, 0.88);
    this.output = new OutputPass();
    this.grade = new ShaderPass(GradeShader);
    this.smaa = new SMAAPass(2, 2);
    for (const p of [this.worldPass, this.gtao, this.vmPass, this.bloom, this.output, this.grade, this.smaa]) this.composer.addPass(p);
    this.applyQuality();
    addEventListener('resize', () => this.resize());
  }

  _lights() {
    const s = this.scene;
    const sky = (this.sky = new Sky()); sky.scale.setScalar(1200);
    const u = sky.material.uniforms; u.turbidity.value = 7.5; u.rayleigh.value = 2.1; u.mieCoefficient.value = 0.0065; u.mieDirectionalG.value = 0.86; u.sunPosition.value.copy(SUN_DIR);
    s.add(sky);
    s.fog = new THREE.FogExp2(0xb79f86, 0.0105);
    this.hemi = new THREE.HemisphereLight(0xc9d4e4, 0x5a4b3a, 0.62); s.add(this.hemi);
    const sun = (this.sun = new THREE.DirectionalLight(0xffcf9e, 3.1));
    sun.castShadow = true; const c = sun.shadow.camera; c.left = c.bottom = -48; c.right = c.top = 48; c.near = 1; c.far = 320;
    sun.shadow.bias = -0.00025; sun.shadow.normalBias = 0.035; sun.position.copy(SUN_DIR).multiplyScalar(160);
    s.add(sun); s.add(sun.target);
    // image-based lighting from the same sky
    const pm = new THREE.PMREMGenerator(this.r), es = new THREE.Scene(), sk2 = new Sky(); sk2.scale.setScalar(500);
    for (const k of Object.keys(u)) if (sk2.material.uniforms[k]) sk2.material.uniforms[k].value = u[k].value;
    es.add(sk2); const ground = new THREE.Mesh(new THREE.CircleGeometry(400, 24).rotateX(-Math.PI / 2), new THREE.MeshBasicMaterial({ color: 0x4a3f33 })); ground.position.y = -2; es.add(ground);
    this.env = pm.fromScene(es, 0.03).texture; pm.dispose();
    s.environment = this.env; this.vmScene.environment = this.env;
    this.vmScene.add(new THREE.HemisphereLight(0xd8e0ea, 0x4a3e30, 0.5));
    this.vmSun = new THREE.DirectionalLight(0xffd6a8, 2.2); this.vmScene.add(this.vmSun); this.vmScene.add(this.vmSun.target);
  }

  applyQuality() {
    this.pr = clamp(Math.min(devicePixelRatio || 1, 2) * settings.renderScale * (this.dynScale || 1), 0.4, 2.5);
    this.r.setPixelRatio(this.pr); this.composer.setPixelRatio(this.pr);
    this.sun.castShadow = !!settings.shadows;
    if (this.sun.shadow.mapSize.x !== settings.shadowRes) { this.sun.shadow.mapSize.set(settings.shadowRes, settings.shadowRes); if (this.sun.shadow.map) { this.sun.shadow.map.dispose(); this.sun.shadow.map = null; } }
    this.gtao.enabled = !!settings.ao && !this.aoShed; this.bloom.enabled = !!settings.bloom; this.smaa.enabled = !!settings.aa;
    this.resize();
  }
  resize() {
    const w = innerWidth, h = innerHeight;
    this.r.setSize(w, h); this.composer.setSize(w, h);
    this.camera.aspect = this.vmCam.aspect = w / h; this.camera.updateProjectionMatrix(); this.vmCam.updateProjectionMatrix();
  }
  // keep the sun's shadow box centred on the player, snapped to texels so shadows don't shimmer
  follow(p) {
    const texel = 96 / settings.shadowRes, x = Math.round(p.x / texel) * texel, z = Math.round(p.z / texel) * texel;
    this.sun.target.position.set(x, 0, z); this.sun.position.copy(SUN_DIR).multiplyScalar(160).add(this.sun.target.position);
    this.sun.target.updateMatrixWorld();
    // light the first-person gun from the same direction as the world sun
    const q = this.camera.quaternion.clone().invert(); this.vmSun.position.copy(SUN_DIR).applyQuaternion(q).multiplyScalar(5);
  }
  render(dt) { this.grade.uniforms.uTime.value += dt; this.composer.render(dt); }
}
