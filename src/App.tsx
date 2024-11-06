// App.tsx
import React, { useEffect, useRef } from "react";
import * as THREE from "three";
import { GLTFLoader } from "three/examples/jsm/loaders/GLTFLoader.js";
import { EXRLoader } from "three/examples/jsm/loaders/EXRLoader.js";
import {
  GPUComputationRenderer,
  Variable,
} from "three/examples/jsm/misc/GPUComputationRenderer.js";
import Info from "./components/Info";
import {
  AUTO_ROTATION_SPEED,
  CAMERA_ORBIT_RADIUS,
  ENVIRONMENT_MAPS,
  GLB_PATH,
  INTERACTION_TIMEOUT,
  NUM_PARTICLES,
  SDF_PATH,
} from "./constants/config";

interface GPUComputationRendererExtended extends GPUComputationRenderer {
  variables: Variable[];
}

const App: React.FC = () => {
  const mountRef = useRef<HTMLDivElement | null>(null);

  // レンダラー、シーン、カメラを保持するRefを作成
  const rendererRef = useRef<THREE.WebGLRenderer | null>(null);
  const sceneRef = useRef<THREE.Scene | null>(null);
  const cameraRef = useRef<THREE.PerspectiveCamera | null>(null);
  const animationFrameIdRef = useRef<number | null>(null);
  const isDraggingRef = useRef<boolean>(false);
  const gpuComputeRef = useRef<GPUComputationRendererExtended | null>(null);
  const rotationMatrixRef = useRef<THREE.Matrix4>(new THREE.Matrix4());
  const currentEnvMapRef = useRef<THREE.Texture | null>(null);
  const autoRotationAngleRef = useRef<number>(0);
  const lastInteractionTimeRef = useRef<number>(Date.now());

  useEffect(() => {
    const mount = mountRef.current;

    if (!mount) return;

    // 初期化済みかどうかを確認
    if (rendererRef.current) return;

    let canceled = false; // クリーンアップ時にキャンセルするためのフラグ

    const init = async () => {
      try {
        // シーン、カメラ、レンダラーの設定
        const scene = new THREE.Scene();
        sceneRef.current = scene;

        const camera = new THREE.PerspectiveCamera(
          75,
          mount.clientWidth / mount.clientHeight,
          0.1,
          1000
        );
        camera.position.z = CAMERA_ORBIT_RADIUS;
        cameraRef.current = camera;

        // WebGL2コンテキストの確認
        const renderer = new THREE.WebGLRenderer({
          antialias: true,
          powerPreference: "high-performance",
        });
        renderer.setSize(mount.clientWidth, mount.clientHeight);
        renderer.setPixelRatio(window.devicePixelRatio);
        renderer.setClearColor(0x000000, 1); // 背景色を黒に設定

        // WebGL2がサポートされているか確認
        if (!renderer.capabilities.isWebGL2) {
          console.error("WebGL2がサポートされていません。");
          return;
        }

        mount.appendChild(renderer.domElement);
        rendererRef.current = renderer;

        // 照明の追加
        const ambientLight = new THREE.AmbientLight(0xffffff, 1.0);
        scene.add(ambientLight);

        // 環境マップの読み込み
        const environmentMap = await loadEnvironment(
          renderer,
          scene,
          ENVIRONMENT_MAPS[1]
        );

        // GLBモデルの読み込み
        const gltfLoader = new GLTFLoader();

        let innerMesh: THREE.Mesh | null = null;

        gltfLoader.load(
          GLB_PATH,
          (gltf) => {
            const sandglassModel = gltf.scene;
            scene.add(sandglassModel);

            // ガラスマテリアルの適用と "inner" メッシュの取得
            sandglassModel.traverse((child) => {
              if ((child as THREE.Mesh).isMesh) {
                const mesh = child as THREE.Mesh;

                // ガラスマテリアルの適用
                mesh.material = new THREE.MeshPhysicalMaterial({
                  color: 0xffffff,
                  metalness: 0,
                  roughness: 0.0,
                  opacity: 1,
                  transparent: true,
                  transmission: 1,
                  thickness: 0.1,
                  envMap: environmentMap,
                  envMapIntensity: 2.0,
                  ior: 1.5,
                  depthWrite: false,
                  side: THREE.DoubleSide,
                });

                if (mesh.name === "inner") {
                  innerMesh = mesh;
                }
              }
            });

            if (!innerMesh) {
              console.error("メッシュ 'inner' が見つかりませんでした。");
              return;
            }

            // 砂粒子を生成
            generateSandParticles(scene, renderer);
          },
          undefined,
          (error) => {
            console.error(
              "GLBモデルの読み込み中にエラーが発生しました:",
              error
            );
          }
        );

        renderer.domElement.addEventListener("mousedown", onMouseDown);
        renderer.domElement.addEventListener("mouseup", onMouseUp);
        renderer.domElement.addEventListener("mouseleave", onMouseUp);
        renderer.domElement.addEventListener("mousemove", onMouseMove);

        // アニメーションループ
        const clock = new THREE.Clock();

        const animate = () => {
          if (canceled) return;

          if (!rendererRef.current || !sceneRef.current || !cameraRef.current)
            return;

          const delta = clock.getDelta();

          // 自動回転の処理
          const currentTime = Date.now();
          if (
            !isDraggingRef.current &&
            currentTime - lastInteractionTimeRef.current > INTERACTION_TIMEOUT
          ) {
            autoRotationAngleRef.current += AUTO_ROTATION_SPEED;

            // カメラを円軌道上で回転
            const camera = cameraRef.current;
            camera.position.x =
              Math.sin(autoRotationAngleRef.current) * CAMERA_ORBIT_RADIUS;
            camera.position.z =
              Math.cos(autoRotationAngleRef.current) * CAMERA_ORBIT_RADIUS;
            camera.lookAt(0, 0, 0);
          }

          if (gpuComputeRef.current) {
            const gpuCompute = gpuComputeRef.current;

            // シーンの回転から回転行列を更新
            rotationMatrixRef.current.makeRotationFromEuler(
              sceneRef.current.rotation
            );

            // 更新シェーダーのUniformにdeltaとtimeを設定
            const velocityVariable = gpuCompute.variables.find(
              (v) => v.name === "textureVelocity"
            );
            const positionVariable = gpuCompute.variables.find(
              (v) => v.name === "texturePosition"
            );

            if (velocityVariable && velocityVariable.material.uniforms) {
              velocityVariable.material.uniforms["delta"].value = delta;
              velocityVariable.material.uniforms["time"].value += delta;
              velocityVariable.material.uniforms["rotationMatrix"].value =
                rotationMatrixRef.current;
              velocityVariable.material.uniforms["particleMass"] = {
                value: 0.1,
              };
              velocityVariable.material.uniforms["minVelocity"] = {
                value: 0.001,
              };
            }
            if (positionVariable && positionVariable.material.uniforms) {
              positionVariable.material.uniforms["delta"].value = delta;
            }

            // GPU計算を実行
            gpuCompute.compute();

            // パーティクルのシェーダーに新しいテクスチャを渡す
            const particles = sceneRef.current.children.find(
              (child) => (child as THREE.Points).isPoints
            ) as THREE.Points | undefined;

            if (
              particles &&
              particles.material instanceof THREE.ShaderMaterial
            ) {
              if (velocityVariable && positionVariable) {
                particles.material.uniforms["texturePosition"].value =
                  gpuCompute.getCurrentRenderTarget(positionVariable).texture;
                particles.material.uniforms["textureVelocity"].value =
                  gpuCompute.getCurrentRenderTarget(velocityVariable).texture;
              }
            }
          }

          rendererRef.current.render(sceneRef.current, cameraRef.current);
          animationFrameIdRef.current = requestAnimationFrame(animate);
        };

        animate();
      } catch (error) {
        console.error("初期化中にエラーが発生しました:", error);
      }
    };

    // 環境マップの読み込み関数
    const loadEnvironment = async (
      renderer: THREE.WebGLRenderer,
      scene: THREE.Scene,
      path: string
    ): Promise<THREE.Texture> => {
      return new Promise((resolve, reject) => {
        const exrLoader = new EXRLoader();
        exrLoader.load(
          path,
          (texture) => {
            texture.mapping = THREE.EquirectangularReflectionMapping;
            texture.colorSpace = THREE.SRGBColorSpace;

            // PMREMGeneratorを使用して環境マップを生成
            const pmremGenerator = new THREE.PMREMGenerator(renderer);
            pmremGenerator.compileEquirectangularShader();

            const envMap = pmremGenerator.fromEquirectangular(texture).texture;

            // 環境マップとして設定
            scene.environment = envMap;

            // 背景には元の高解像度テクスチャを使用
            scene.background = texture;

            // 以前の環境マップを破棄
            if (currentEnvMapRef.current) {
              currentEnvMapRef.current.dispose();
            }
            currentEnvMapRef.current = envMap;

            // 不要なリソースを解放
            pmremGenerator.dispose();

            resolve(envMap);
          },
          undefined,
          (error) => {
            console.error(
              "環境マップの読み込み中にエラーが発生しました:",
              error
            );
            reject(error);
          }
        );
      });
    };

    // 砂粒子を生成する関数
    const generateSandParticles = async (
      scene: THREE.Scene,
      renderer: THREE.WebGLRenderer
    ) => {
      const gpuCompute = new GPUComputationRenderer(
        256,
        256,
        renderer
      ) as GPUComputationRendererExtended;
      gpuComputeRef.current = gpuCompute;

      // **SDFテクスチャを事前に生成されたファイルから読み込む**
      // SDFテクスチャを読み込む
      const sdfResult = await loadSDFTexture(SDF_PATH);
      const sdfTexture = sdfResult.texture;
      const sdfSize = sdfResult.size;
      const sdfMin = sdfResult.min;
      const sdfMax = sdfResult.max;

      // テクスチャの初期化
      const dtPosition = gpuCompute.createTexture();
      const dtVelocity = gpuCompute.createTexture();

      // 初期位置と速度を設定（SDF範囲内）
      fillPositionTexture(dtPosition, sdfMin, sdfMax);
      fillVelocityTexture(dtVelocity);

      // シェーダーの読み込み
      const positionVariable = gpuCompute.addVariable(
        "texturePosition",
        positionShader(),
        dtPosition
      );
      const velocityVariable = gpuCompute.addVariable(
        "textureVelocity",
        velocityShader(),
        dtVelocity
      );

      if (positionVariable === null || velocityVariable === null) {
        console.error(
          "GPUComputationRendererの変数が正しく設定されていません。"
        );
        return;
      }

      // デペンデンシーの設定
      gpuCompute.setVariableDependencies(positionVariable, [
        positionVariable,
        velocityVariable,
      ]);
      gpuCompute.setVariableDependencies(velocityVariable, [
        positionVariable,
        velocityVariable,
      ]);

      // パラメータの設定
      velocityVariable.material.uniforms["gravity"] = {
        value: new THREE.Vector3(0, -9.81, 0),
      };
      velocityVariable.material.uniforms["time"] = { value: 0.0 };
      velocityVariable.material.uniforms["delta"] = { value: 0.0 };
      velocityVariable.material.uniforms["sdfTexture"] = { value: sdfTexture };
      velocityVariable.material.uniforms["sdfSize"] = { value: sdfSize };
      velocityVariable.material.uniforms["sdfMin"] = { value: sdfMin };
      velocityVariable.material.uniforms["sdfMax"] = { value: sdfMax };
      velocityVariable.material.uniforms["rotationMatrix"] = {
        value: rotationMatrixRef.current,
      };

      positionVariable.material.uniforms["delta"] = { value: 0.0 };
      positionVariable.material.uniforms["sdfTexture"] = { value: sdfTexture };
      positionVariable.material.uniforms["sdfSize"] = { value: sdfSize };
      positionVariable.material.uniforms["sdfMin"] = { value: sdfMin };
      positionVariable.material.uniforms["sdfMax"] = { value: sdfMax };

      // エラーのチェック
      const error = gpuCompute.init();
      if (error !== null) {
        console.error(error);
      }

      // パーティクルの描画用メッシュを作成
      const geometry = new THREE.BufferGeometry();
      const positions = new Float32Array(NUM_PARTICLES * 3);

      // UV を手動で初期化
      const uvs = new Float32Array(NUM_PARTICLES * 2);

      for (let i = 0; i < NUM_PARTICLES; i++) {
        const x = (i % 256) / 256;
        const y = Math.floor(i / 256) / 256;
        uvs[i * 2] = x;
        uvs[i * 2 + 1] = y;
      }

      geometry.setAttribute(
        "position",
        new THREE.BufferAttribute(positions, 3)
      );
      geometry.setAttribute("uv", new THREE.BufferAttribute(uvs, 2));

      const material = new THREE.ShaderMaterial({
        uniforms: {
          texturePosition: { value: null },
          textureVelocity: { value: null },
          sdfTexture: { value: sdfTexture },
          sdfMin: { value: sdfMin },
          sdfMax: { value: sdfMax },
        },
        vertexShader: particleVertexShader(),
        fragmentShader: particleFragmentShader(),
        transparent: true,
      });

      const particles = new THREE.Points(geometry, material);
      scene.add(particles);
    };

    // SDFテクスチャを読み込む関数を追加
    const loadSDFTexture = async (
      path: string
    ): Promise<{
      texture: THREE.Data3DTexture;
      size: number;
      min: THREE.Vector3;
      max: THREE.Vector3;
    }> => {
      const response = await fetch(path);
      if (!response.ok) {
        throw new Error(`Failed to load SDF texture from ${path}`);
      }
      const sdfJson = await response.json();

      const size = sdfJson.size;
      const dataArray = new Float32Array(sdfJson.data);
      const min = new THREE.Vector3().fromArray(sdfJson.min);
      const max = new THREE.Vector3().fromArray(sdfJson.max);

      const texture = new THREE.Data3DTexture(dataArray, size, size, size);
      texture.format = THREE.RedFormat;
      texture.type = THREE.FloatType;
      texture.minFilter = THREE.LinearFilter;
      texture.magFilter = THREE.LinearFilter;
      texture.wrapS = THREE.ClampToEdgeWrapping;
      texture.wrapT = THREE.ClampToEdgeWrapping;
      texture.wrapR = THREE.ClampToEdgeWrapping;
      texture.unpackAlignment = 1;
      texture.needsUpdate = true;

      return { texture, size, min, max };
    };

    // 位置テクスチャの初期化
    const fillPositionTexture = (
      texture: THREE.DataTexture,
      min: THREE.Vector3,
      max: THREE.Vector3
    ) => {
      const data = texture.image.data;
      const center = new THREE.Vector3()
        .addVectors(min, max)
        .multiplyScalar(0.5);
      const range = new THREE.Vector3().subVectors(max, min);

      for (let i = 0; i < data.length; i += 4) {
        // より狭い範囲に初期配置を集中
        const x = center.x + (Math.random() - 0.5) * range.x * 0.3;
        const y = THREE.MathUtils.lerp(center.y, max.y * 0.9, Math.random()); // 上部により集中
        const z = center.z + (Math.random() - 0.5) * range.z * 0.3;

        data[i] = x;
        data[i + 1] = y;
        data[i + 2] = z;
        data[i + 3] = 1.0; // 初期状態では外側として設定
      }
    };

    // 速度テクスチャの初期化
    const fillVelocityTexture = (texture: THREE.DataTexture) => {
      const data = texture.image.data;

      for (let i = 0; i < data.length; i += 4) {
        data[i] = 0.0; // vx
        data[i + 1] = 0.0; // vy
        data[i + 2] = 0.0; // vz
        data[i + 3] = 0.0; // w
      }
    };

    // 位置更新用のシェーダー
    const positionShader = () => {
      return `
        uniform float delta;
  uniform sampler3D sdfTexture;
  uniform int sdfSize;
  uniform vec3 sdfMin;
  uniform vec3 sdfMax;
  
  float getSDF(vec3 pos) {
    vec3 sdfUV = (pos - sdfMin) / (sdfMax - sdfMin);
    if(any(lessThan(sdfUV, vec3(0.0))) || any(greaterThan(sdfUV, vec3(1.0)))) {
      return 1000.0;
    }
    return texture(sdfTexture, sdfUV).r;
  }
  
  void main() {
    vec2 uv = gl_FragCoord.xy / resolution.xy;
    vec4 pos = texture2D(texturePosition, uv);
    vec4 vel = texture2D(textureVelocity, uv);
    
    // Verlet積分による位置更新
    vec3 newPos = pos.xyz + vel.xyz * delta;
    
    // SDFによる内外判定を保存
    float sdf = getSDF(newPos);
    
    gl_FragColor = vec4(newPos, sdf < 0.0 ? -1.0 : 1.0); // w成分に内外判定を保存
  }
      `;
    };

    // 速度更新用のシェーダー
    const velocityShader = () => {
      return `
uniform float time;
uniform float delta;
uniform vec3 gravity;
uniform sampler3D sdfTexture;
uniform int sdfSize;
uniform vec3 sdfMin;
uniform vec3 sdfMax;
uniform mat4 rotationMatrix;

// 物理パラメータの調整
const float COLLISION_DAMPING = 0.3;      // 衝突時の減衰
const float FRICTION = 0.98;              // 摩擦係数
const float PARTICLE_RADIUS = 0.015;      // パーティクルサイズ
const float REPULSION_STRENGTH = 1.5;     // 反発力
const float PARTICLE_MASS = 0.5;          // 質量を増やして落下速度を調整
const float MIN_VELOCITY = 0.001;
const float SDF_THRESHOLD = 0.02;

// 衝突検出の改善のためのパラメータ
const int COLLISION_ITERATIONS = 4;        // 衝突検出の反復回数を増やす
const float MAX_STEP = 0.02;              // 1フレームでの最大移動距離
const float GRAVITY_SCALE = 0.3;          // 重力スケール（落下速度調整用）

vec3 computeNormal(vec3 pos) {
    vec3 sdfUV = (pos - sdfMin) / (sdfMax - sdfMin);
    float eps = 0.5 / float(sdfSize);
    vec3 d;
    d.x = texture(sdfTexture, sdfUV + vec3(eps, 0.0, 0.0)).r - 
          texture(sdfTexture, sdfUV - vec3(eps, 0.0, 0.0)).r;
    d.y = texture(sdfTexture, sdfUV + vec3(0.0, eps, 0.0)).r - 
          texture(sdfTexture, sdfUV - vec3(0.0, eps, 0.0)).r;
    d.z = texture(sdfTexture, sdfUV + vec3(0.0, 0.0, eps)).r - 
          texture(sdfTexture, sdfUV - vec3(0.0, 0.0, eps)).r;
    return normalize(d);
}

float getSDF(vec3 pos) {
    vec3 sdfUV = (pos - sdfMin) / (sdfMax - sdfMin);
    if(any(lessThan(sdfUV, vec3(-0.1))) || any(greaterThan(sdfUV, vec3(1.1)))) {
        return 1000.0;
    }
    // SDFの値を補間して滑らかにする
    vec3 clampedUV = clamp(sdfUV, vec3(0.0), vec3(1.0));
    float sdfValue = texture(sdfTexture, clampedUV).r;
    
    // SDFの影響を強める
    return sdfValue * 0.8; // SDFの値を若干強調
}

vec3 computeParticleInteraction(vec2 uv, vec3 pos, vec3 vel) {
    vec3 totalForce = vec3(0.0);
    float searchRadius = PARTICLE_RADIUS * 4.0;
    int neighborCount = 0;
    
    for(float dy = -3.0; dy <= 3.0; dy += 1.0) {
        for(float dx = -3.0; dx <= 3.0; dx += 1.0) {
            if(dx == 0.0 && dy == 0.0) continue;
            
            vec2 neighborUV = uv + vec2(dx, dy) / resolution.xy;
            if(any(lessThan(neighborUV, vec2(0.0))) || any(greaterThan(neighborUV, vec2(1.0)))) {
                continue;
            }
            
            vec4 neighborPosData = texture2D(texturePosition, neighborUV);
            vec4 neighborVelData = texture2D(textureVelocity, neighborUV);
            
            vec3 diff = pos - neighborPosData.xyz;
            float dist = length(diff);
            
            if(dist < searchRadius && dist > 0.0) {
                // 反発力の計算
                float influence = 1.0 - dist / searchRadius;
                influence = influence * influence;
                totalForce += normalize(diff) * influence * REPULSION_STRENGTH;
                
                // 粘性の計算
                vec3 velDiff = vel - neighborVelData.xyz;
                totalForce -= velDiff * influence * 0.1;
                
                neighborCount++;
            }
        }
    }
    
    return totalForce;
}

void main() {
    vec2 uv = gl_FragCoord.xy / resolution.xy;
    vec4 posData = texture2D(texturePosition, uv);
    vec4 vel = texture2D(textureVelocity, uv);
    vec3 pos = posData.xyz;
    
    // 回転を考慮した重力の適用（スケールを調整）
    vec3 rotatedGravity = (rotationMatrix * vec4(gravity * GRAVITY_SCALE, 0.0)).xyz;
    vec3 force = rotatedGravity;
    
    // パーティクル間の相互作用を計算
    force += computeParticleInteraction(uv, pos, vel.xyz);
    
    // 速度の更新（時間刻みを小さくする）
    float adjustedDelta = min(delta, 0.016); // 最大時間刻みを制限
    vec3 newVel = vel.xyz + force * (adjustedDelta / PARTICLE_MASS);
    
    // 速度の大きさを制限
    float speedLimit = MAX_STEP / adjustedDelta;
    float currentSpeed = length(newVel);
    if(currentSpeed > speedLimit) {
        newVel = (newVel / currentSpeed) * speedLimit;
    }
    
    // 複数回の衝突チェックを行う
    vec3 testPos = pos;
    for(int i = 0; i < COLLISION_ITERATIONS; i++) {
        // 予測位置の計算
        vec3 nextPos = testPos + newVel * (adjustedDelta / float(COLLISION_ITERATIONS));
        float sdf = getSDF(nextPos);
        
        if(sdf > -SDF_THRESHOLD) {
            vec3 normal = computeNormal(testPos);
            
            // 衝突応答
            float penetration = sdf + SDF_THRESHOLD;
            testPos = nextPos + normal * penetration;
            
            // 速度の反射と減衰
            float normalVel = dot(newVel, normal);
            if(normalVel < 0.0) {
                newVel = reflect(newVel, normal) * COLLISION_DAMPING;
                
                // 摩擦の適用
                vec3 tangentVel = newVel - normal * dot(newVel, normal);
                newVel -= tangentVel * (1.0 - FRICTION);
            }
        } else {
            testPos = nextPos;
        }
    }
    
    // 最小速度のチェック
    if(length(newVel) < MIN_VELOCITY) {
        newVel = vec3(0.0);
    }
    
    gl_FragColor = vec4(newVel, 1.0);
}
      `;
    };

    // パーティクルの頂点シェーダー
    const particleVertexShader = () => {
      return `
        uniform sampler2D texturePosition;
  uniform sampler3D sdfTexture;
  uniform vec3 sdfMin;
  uniform vec3 sdfMax;

  varying float vIsInside;

  void main() {
    vec4 posData = texture2D(texturePosition, uv);
    vec3 pos = posData.xyz;
    vIsInside = posData.w; // 内外判定を渡す

    gl_Position = projectionMatrix * modelViewMatrix * vec4(pos, 1.0);
    gl_PointSize = 2.0; // パーティクルサイズを少し大きく
  }
      `;
    };

    // パーティクルのフラグメントシェーダー
    const particleFragmentShader = () => {
      return `
        varying float vIsInside;
    
        void main() {
          // パーティクルの形状を円形に
          vec2 center = gl_PointCoord - vec2(0.5);
          float dist = length(center);
          
          if(dist > 0.5 || vIsInside >= 0.0) {
            discard;
          }
          
          // より柔らかい砂の色
          vec3 sandColor = vec3(0.93, 0.87, 0.73);
          float alpha = smoothstep(0.5, 0.4, dist); // エッジを柔らかく
          
          gl_FragColor = vec4(sandColor, alpha);
        }
      `;
    };

    // マウスイベントの設定
    const onMouseDown = () => {
      isDraggingRef.current = true;
      lastInteractionTimeRef.current = Date.now();
    };

    const onMouseUp = () => {
      isDraggingRef.current = false;
      lastInteractionTimeRef.current = Date.now();
    };

    const onMouseMove = (event: MouseEvent) => {
      if (isDraggingRef.current && sceneRef.current) {
        const deltaMove = {
          x: event.movementX,
          y: event.movementY,
        };

        const rotationSpeed = 0.005;

        // シーン全体を回転
        sceneRef.current.rotation.y += deltaMove.x * rotationSpeed;
        sceneRef.current.rotation.x += deltaMove.y * rotationSpeed;

        lastInteractionTimeRef.current = Date.now();
      }
    };

    init();

    // ウィンドウリサイズの処理
    const onWindowResize = () => {
      if (!rendererRef.current || !cameraRef.current) return;
      const renderer = rendererRef.current;
      const camera = cameraRef.current;
      camera.aspect = mount.clientWidth / mount.clientHeight;
      camera.updateProjectionMatrix();
      renderer.setSize(mount.clientWidth, mount.clientHeight);
    };

    window.addEventListener("resize", onWindowResize);

    // キーボードイベントハンドラ
    const handleKeyDown = async (event: KeyboardEvent) => {
      const key = event.key;
      if (!rendererRef.current || !sceneRef.current) return;

      if (key in ENVIRONMENT_MAPS) {
        const mapPath =
          ENVIRONMENT_MAPS[key as unknown as keyof typeof ENVIRONMENT_MAPS];
        try {
          const newEnvMap = await loadEnvironment(
            rendererRef.current,
            sceneRef.current,
            mapPath
          );

          // ガラスマテリアルの環境マップを更新
          sceneRef.current.traverse((child) => {
            if ((child as THREE.Mesh).isMesh) {
              const mesh = child as THREE.Mesh;
              if (mesh.material instanceof THREE.MeshPhysicalMaterial) {
                mesh.material.envMap = newEnvMap;
                mesh.material.needsUpdate = true;
              }
            }
          });
        } catch (error) {
          console.error("環境マップの読み込みに失敗しました:", error);
        }
      }
    };

    window.addEventListener("keydown", handleKeyDown);

    // クリーンアップ
    return () => {
      canceled = true;
      window.removeEventListener("resize", onWindowResize);
      window.removeEventListener("keydown", handleKeyDown);

      if (animationFrameIdRef.current !== null) {
        cancelAnimationFrame(animationFrameIdRef.current);
        animationFrameIdRef.current = null;
      }

      if (rendererRef.current) {
        const renderer = rendererRef.current;
        renderer.domElement.removeEventListener("mousedown", onMouseDown);
        renderer.domElement.removeEventListener("mouseup", onMouseUp);
        renderer.domElement.removeEventListener("mouseleave", onMouseUp);
        renderer.domElement.removeEventListener("mousemove", onMouseMove);
        if (renderer.domElement && renderer.domElement.parentNode === mount) {
          mount.removeChild(renderer.domElement);
        }
        renderer.dispose();
        rendererRef.current = null;
      }

      // 他のリソースのクリーンアップも必要に応じて行う
      sceneRef.current = null;
      cameraRef.current = null;
      isDraggingRef.current = false;
      gpuComputeRef.current = null;
    };
  }, []);

  return (
    <div
      ref={mountRef}
      style={{
        width: "100vw",
        height: "100vh",
        overflow: "hidden",
        position: "relative",
      }}
    >
      <Info />
    </div>
  );
};

export default App;
