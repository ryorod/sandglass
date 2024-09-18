import React, { useEffect, useRef } from "react";
import * as THREE from "three";
import * as RAPIER from "@dimforge/rapier3d-compat";

const App: React.FC = () => {
  const mountRef = useRef<HTMLDivElement | null>(null);

  // レンダラー、シーン、カメラ、物理ワールドを保持するRefを作成
  const rendererRef = useRef<THREE.WebGLRenderer | null>(null);
  const sceneRef = useRef<THREE.Scene | null>(null);
  const cameraRef = useRef<THREE.PerspectiveCamera | null>(null);
  const rapierWorldRef = useRef<RAPIER.World | null>(null);
  const animationFrameIdRef = useRef<number | null>(null);

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
        const renderer = new THREE.WebGLRenderer({ antialias: true });
        renderer.setSize(mount.clientWidth, mount.clientHeight);
        renderer.setPixelRatio(window.devicePixelRatio);
        renderer.setClearColor(0x20252f, 1); // 背景色を設定
        mount.appendChild(renderer.domElement);

        const scene = new THREE.Scene();

        const camera = new THREE.PerspectiveCamera(
          75,
          mount.clientWidth / mount.clientHeight,
          0.1,
          1000
        );
        camera.position.z = 10;

        // 照明の追加
        const ambientLight = new THREE.AmbientLight(0xffffff, 0.5);
        scene.add(ambientLight);

        const directionalLight = new THREE.DirectionalLight(0xffffff, 1);
        directionalLight.position.set(10, 10, 10);
        scene.add(directionalLight);

        // Rapier の物理ワールドを作成
        const rapierWorld = new RAPIER.World({ x: 0, y: -9.81, z: 0 });

        // ガラスの素材
        const glassMaterial = new THREE.MeshStandardMaterial({
          color: 0xaaaaaa,
          metalness: 0.1,
          roughness: 0.5,
          opacity: 0.5,
          transparent: true,
        });
        const sandMaterial = new THREE.MeshStandardMaterial({
          color: 0xffd700,
        });

        // 砂時計のビジュアルメッシュを作成
        const topGlassGeometry = new THREE.CylinderGeometry(2, 2, 4, 32);
        const topGlassMesh = new THREE.Mesh(topGlassGeometry, glassMaterial);
        topGlassMesh.position.y = 2;
        scene.add(topGlassMesh);

        const bottomGlassGeometry = new THREE.CylinderGeometry(2, 2, 4, 32);
        const bottomGlassMesh = new THREE.Mesh(
          bottomGlassGeometry,
          glassMaterial
        );
        bottomGlassMesh.position.y = -2;
        scene.add(bottomGlassMesh);

        const middleGlassGeometry = new THREE.CylinderGeometry(0.2, 0.2, 1, 32);
        const middleGlassMesh = new THREE.Mesh(
          middleGlassGeometry,
          glassMaterial
        );
        scene.add(middleGlassMesh);

        // オイラー角から四元数を生成
        const threeQuaternion = new THREE.Quaternion();
        threeQuaternion.setFromEuler(new THREE.Euler(Math.PI / 2, 0, 0));

        // Rapier.js の Rotation 型の四元数を作成
        const rotation = new RAPIER.Quaternion(
          threeQuaternion.x,
          threeQuaternion.y,
          threeQuaternion.z,
          threeQuaternion.w
        );

        // ガラスの物理コライダーを作成（静的）
        const topGlassColliderDesc = RAPIER.ColliderDesc.cylinder(2, 2)
          .setTranslation(0, 2, 0)
          .setRotation(rotation);
        rapierWorld.createCollider(topGlassColliderDesc);

        const bottomGlassColliderDesc = RAPIER.ColliderDesc.cylinder(2, 2)
          .setTranslation(0, -2, 0)
          .setRotation(rotation);
        rapierWorld.createCollider(bottomGlassColliderDesc);

        const middleGlassColliderDesc = RAPIER.ColliderDesc.cylinder(0.2, 0.5)
          .setTranslation(0, 0, 0)
          .setRotation(rotation);
        rapierWorld.createCollider(middleGlassColliderDesc);

        // 砂粒を生成
        const sandMeshes: THREE.Mesh[] = [];
        const sandRigidBodies: RAPIER.RigidBody[] = [];
        const numSand = 200;

        for (let i = 0; i < numSand; i++) {
          // Three.js のメッシュ
          const sphereGeometry = new THREE.SphereGeometry(0.1, 8, 8);
          const sandMesh = new THREE.Mesh(sphereGeometry, sandMaterial);

          // ランダムな位置に配置
          sandMesh.position.set(
            (Math.random() - 0.5) * 1.5,
            Math.random() * 3 + 1,
            (Math.random() - 0.5) * 1.5
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
          const colliderDesc = RAPIER.ColliderDesc.ball(0.1);
          rapierWorld.createCollider(colliderDesc, rigidBody);

          sandRigidBodies.push(rigidBody);
        }

        // アニメーションループ
        const animate = () => {
          if (canceled) return;

          rapierWorld.step();

          // Three.js のメッシュを物理シミュレーションに合わせて更新
          for (let i = 0; i < sandMeshes.length; i++) {
            const rigidBody = sandRigidBodies[i];
            const position = rigidBody.translation();
            const rotation = rigidBody.rotation();

            sandMeshes[i].position.set(position.x, position.y, position.z);
            sandMeshes[i].quaternion.set(
              rotation.x,
              rotation.y,
              rotation.z,
              rotation.w
            );
          }

          renderer.render(scene, camera);
          animationFrameIdRef.current = requestAnimationFrame(animate);
        };

        animate();

        // レンダラー、シーン、カメラ、物理ワールドをRefに保存
        rendererRef.current = renderer;
        sceneRef.current = scene;
        cameraRef.current = camera;
        rapierWorldRef.current = rapierWorld;
      } catch (error) {
        console.error("初期化中にエラーが発生しました:", error);
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
