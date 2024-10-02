import React, { useEffect, useRef } from "react";
import * as THREE from "three";
import * as RAPIER from "@dimforge/rapier3d-compat";
import { GLTFLoader } from "three/examples/jsm/loaders/GLTFLoader.js";
import { EXRLoader } from "three/examples/jsm/loaders/EXRLoader.js";

const App: React.FC = () => {
  const mountRef = useRef<HTMLDivElement | null>(null);

  // レンダラー、シーン、カメラ、物理ワールドを保持するRefを作成
  const rendererRef = useRef<THREE.WebGLRenderer | null>(null);
  const sceneRef = useRef<THREE.Scene | null>(null);
  const cameraRef = useRef<THREE.PerspectiveCamera | null>(null);
  const rapierWorldRef = useRef<RAPIER.World | null>(null);
  const animationFrameIdRef = useRef<number | null>(null);
  const sandMeshesRef = useRef<THREE.Mesh[]>([]);
  const sandRigidBodiesRef = useRef<RAPIER.RigidBody[]>([]);
  const sandglassModelRef = useRef<THREE.Group | null>(null);
  const sandglassRigidBodyRef = useRef<RAPIER.RigidBody | null>(null);
  const isDraggingRef = useRef<boolean>(false);

  useEffect(() => {
    const mount = mountRef.current;

    if (!mount) return;

    // 初期化済みかどうかを確認
    if (rendererRef.current) return;

    let canceled = false; // クリーンアップ時にキャンセルするためのフラグ

    const init = async () => {
      try {
        // Rapier.js の初期化
        await RAPIER.init();

        if (canceled) return; // クリーンアップされた場合は何もしない

        // シーン、カメラ、レンダラーの設定
        const scene = new THREE.Scene();
        sceneRef.current = scene;

        const camera = new THREE.PerspectiveCamera(
          75,
          mount.clientWidth / mount.clientHeight,
          0.1,
          1000
        );
        camera.position.z = 2.5;
        cameraRef.current = camera;

        const renderer = new THREE.WebGLRenderer({ antialias: true });
        renderer.setSize(mount.clientWidth, mount.clientHeight);
        renderer.setPixelRatio(window.devicePixelRatio);
        renderer.setClearColor(0x000000, 1); // 背景色を黒に設定

        mount.appendChild(renderer.domElement);
        rendererRef.current = renderer;

        // 照明の追加
        const ambientLight = new THREE.AmbientLight(0xffffff, 1.0); // 強度を1.0に変更
        scene.add(ambientLight);

        const directionalLight = new THREE.DirectionalLight(0xffffff, 2.0); // 強度を2.0に変更
        directionalLight.position.set(10, 10, 10);
        scene.add(directionalLight);

        // HemisphereLightの追加
        const hemisphereLight = new THREE.HemisphereLight(
          0xffffff,
          0x444444,
          0.6
        );
        hemisphereLight.position.set(0, 20, 0);
        scene.add(hemisphereLight);

        // Rapier の物理ワールドを作成
        const rapierWorld = new RAPIER.World({ x: 0, y: -9.81, z: 0 });
        rapierWorldRef.current = rapierWorld;

        // 環境マップの読み込み
        const environmentMap = await loadEnvironment(renderer, scene);

        // GLBモデルの読み込み
        const gltfLoader = new GLTFLoader();
        const glbPath = "/model/sandglass.glb"; // GLBファイルのパスを指定

        gltfLoader.load(
          glbPath,
          (gltf) => {
            const sandglassModel = gltf.scene;
            scene.add(sandglassModel);
            sandglassModelRef.current = sandglassModel;

            // 砂時計のキネマティックリジッドボディを作成
            const sandglassRigidBodyDesc =
              RAPIER.RigidBodyDesc.kinematicPositionBased();
            const sandglassRigidBody = rapierWorld.createRigidBody(
              sandglassRigidBodyDesc
            );
            sandglassRigidBodyRef.current = sandglassRigidBody;

            // ガラスマテリアルの適用とコライダーの設定
            sandglassModel.traverse((child) => {
              if ((child as THREE.Mesh).isMesh) {
                const mesh = child as THREE.Mesh;

                // ガラスマテリアルの適用
                mesh.material = new THREE.MeshPhysicalMaterial({
                  color: 0xffffff,
                  metalness: 0,
                  roughness: 0.0, // 反射を強くするために0.0に設定
                  opacity: 1,
                  transparent: true,
                  transmission: 1, // ガラスのように透明にする
                  thickness: 0.1, // ガラスの厚み
                  envMap: environmentMap,
                  envMapIntensity: 2.0, // 環境マップの影響を強める
                  ior: 1.5, // 屈折率
                });

                // 内側の面にコライダーを設定
                if (mesh.name === "inner") {
                  const colliderDesc = createColliderFromMesh(mesh);
                  rapierWorld.createCollider(colliderDesc, sandglassRigidBody);
                }
              }
            });

            // 砂粒子を生成
            generateSandParticles(scene, rapierWorld);
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
        const animate = () => {
          if (canceled) return;

          if (
            !rendererRef.current ||
            !sceneRef.current ||
            !cameraRef.current ||
            !rapierWorldRef.current
          )
            return;

          rapierWorldRef.current.step();

          // 砂粒子の位置と回転を更新
          for (let i = 0; i < sandMeshesRef.current.length; i++) {
            const rigidBody = sandRigidBodiesRef.current[i];
            const position = rigidBody.translation();
            const rotation = rigidBody.rotation();

            sandMeshesRef.current[i].position.set(
              position.x,
              position.y,
              position.z
            );
            sandMeshesRef.current[i].quaternion.set(
              rotation.x,
              rotation.y,
              rotation.z,
              rotation.w
            );
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
      scene: THREE.Scene
    ): Promise<THREE.Texture> => {
      return new Promise((resolve, reject) => {
        const exrLoader = new EXRLoader();
        exrLoader.load(
          "/tex/kloppenheim_06_puresky_4k.exr", // EXRファイルのパスを指定
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

    // メッシュからコライダーを作成する関数
    const createColliderFromMesh = (mesh: THREE.Mesh): RAPIER.ColliderDesc => {
      const geometry = mesh.geometry as THREE.BufferGeometry;
      const positionAttribute = geometry.getAttribute(
        "position"
      ) as THREE.BufferAttribute;

      // Positions as Float32Array
      const positions = new Float32Array(
        positionAttribute.count * positionAttribute.itemSize
      );
      for (let i = 0; i < positionAttribute.count; i++) {
        positions[i * 3] = positionAttribute.getX(i) * mesh.scale.x;
        positions[i * 3 + 1] = positionAttribute.getY(i) * mesh.scale.y;
        positions[i * 3 + 2] = positionAttribute.getZ(i) * mesh.scale.z;
      }

      let indices: Uint32Array;
      if (geometry.index) {
        const indexArray = geometry.index.array;
        indices = new Uint32Array(geometry.index.count);
        for (let i = 0; i < geometry.index.count; i++) {
          indices[i] = indexArray[i];
        }
      } else {
        const indicesCount = positionAttribute.count;
        indices = new Uint32Array(indicesCount);
        for (let i = 0; i < indicesCount; i++) {
          indices[i] = i;
        }
      }

      const colliderDesc = RAPIER.ColliderDesc.trimesh(positions, indices);
      colliderDesc.setTranslation(
        mesh.position.x,
        mesh.position.y,
        mesh.position.z
      );
      colliderDesc.setRotation({
        x: mesh.quaternion.x,
        y: mesh.quaternion.y,
        z: mesh.quaternion.z,
        w: mesh.quaternion.w,
      });

      return colliderDesc;
    };

    // 砂粒子を生成する関数
    const generateSandParticles = (
      scene: THREE.Scene,
      rapierWorld: RAPIER.World
    ) => {
      const sandMaterial = new THREE.MeshStandardMaterial({
        color: 0xbfa539,
      });

      const sandMeshes: THREE.Mesh[] = [];
      const sandRigidBodies: RAPIER.RigidBody[] = [];
      const numSand = 2000; // 必要に応じて調整

      for (let i = 0; i < numSand; i++) {
        const sphereGeometry = new THREE.SphereGeometry(0.005, 8, 8);
        const sandMesh = new THREE.Mesh(sphereGeometry, sandMaterial);

        // 内側の空間にランダムに配置
        sandMesh.position.set(
          (Math.random() - 0.5) * 0.1, // X座標
          Math.random() * 0.05 - 0.95, // Y座標
          (Math.random() - 0.5) * 0.1 // Z座標
        );
        scene.add(sandMesh);
        sandMeshes.push(sandMesh);

        // Rapier のリジッドボディ
        const rigidBodyDesc = RAPIER.RigidBodyDesc.dynamic().setTranslation(
          sandMesh.position.x,
          sandMesh.position.y,
          sandMesh.position.z
        );
        const rigidBody = rapierWorld.createRigidBody(rigidBodyDesc);

        // コライダー
        const colliderDesc = RAPIER.ColliderDesc.ball(0.005)
          .setDensity(1600) // 密度を設定
          .setRestitution(0.1) // 反発係数
          .setFriction(0.6); // 摩擦係数
        rapierWorld.createCollider(colliderDesc, rigidBody);

        sandRigidBodies.push(rigidBody);
      }

      sandMeshesRef.current = sandMeshes;
      sandRigidBodiesRef.current = sandRigidBodies;
    };

    // マウスイベントの設定
    const onMouseDown = () => {
      isDraggingRef.current = true;
    };

    const onMouseUp = () => {
      isDraggingRef.current = false;
    };

    const onMouseMove = (event: MouseEvent) => {
      if (
        isDraggingRef.current &&
        sandglassModelRef.current &&
        sandglassRigidBodyRef.current
      ) {
        const deltaMove = {
          x: event.movementX,
          y: event.movementY,
        };

        const rotationSpeed = 0.005;
        const sandglass = sandglassModelRef.current;
        const sandglassRigidBody = sandglassRigidBodyRef.current;

        // Three.jsのメッシュを回転
        sandglass.rotation.y += deltaMove.x * rotationSpeed;
        sandglass.rotation.x += deltaMove.y * rotationSpeed;

        // メッシュの回転を取得してクォータニオンに変換
        const euler = new THREE.Euler(
          sandglass.rotation.x,
          sandglass.rotation.y,
          sandglass.rotation.z
        );
        const quaternion = new THREE.Quaternion();
        quaternion.setFromEuler(euler);

        // リジッドボディの回転を更新
        sandglassRigidBody.setNextKinematicRotation({
          x: quaternion.x,
          y: quaternion.y,
          z: quaternion.z,
          w: quaternion.w,
        });
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

    // クリーンアップ
    return () => {
      canceled = true;
      window.removeEventListener("resize", onWindowResize);

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
      rapierWorldRef.current = null;
      sandMeshesRef.current = [];
      sandRigidBodiesRef.current = [];
      sandglassModelRef.current = null;
      sandglassRigidBodyRef.current = null;
      isDraggingRef.current = false;
    };
  }, []);

  return (
    <div
      ref={mountRef}
      style={{ width: "100vw", height: "100vh", overflow: "hidden" }}
    />
  );
};

export default App;
