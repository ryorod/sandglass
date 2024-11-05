import * as fs from "fs";
import * as path from "path";
import * as THREE from "three";
import { GLTF, GLTFLoader } from "three/examples/jsm/loaders/GLTFLoader.js";
import { MeshBVH, acceleratedRaycast } from "three-mesh-bvh";
import { fileURLToPath } from "url";
import * as BufferGeometryUtils from "three/examples/jsm/utils/BufferGeometryUtils.js";

// Node.js の __dirname と __filename を取得
const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

// three-mesh-bvh の acceleratedRaycast を有効化
THREE.Mesh.prototype.raycast = acceleratedRaycast;

// 設定パラメータ
const CONFIG = {
  SDF_SIZE: 128,
  RAY_DIRECTIONS: 14, // レイの方向数を増やす
  BOUNDARY_EPSILON: 1e-5,
  SMOOTHING_RADIUS: 1.5, // 平滑化の範囲
  ADAPTIVE_SAMPLING: true, // アダプティブサンプリングの有効化
  GRADIENT_THRESHOLD: 0.1, // 勾配閾値
} as const;

// 均一に分布したレイの方向を生成
function generateUniformRayDirections(numDirections: number): THREE.Vector3[] {
  const directions: THREE.Vector3[] = [];
  const goldenRatio = (1 + Math.sqrt(5)) / 2;
  const angleIncrement = Math.PI * 2 * goldenRatio;

  for (let i = 0; i < numDirections; i++) {
    const t = i / numDirections;
    const inclination = Math.acos(1 - 2 * t);
    const azimuth = angleIncrement * i;

    const x = Math.sin(inclination) * Math.cos(azimuth);
    const y = Math.sin(inclination) * Math.sin(azimuth);
    const z = Math.cos(inclination);

    directions.push(new THREE.Vector3(x, y, z).normalize());
  }

  return directions;
}

// 勾配を計算する関数
function computeGradient(
  point: THREE.Vector3,
  epsilon: number,
  geometry: THREE.BufferGeometry,
  bvh: MeshBVH
): THREE.Vector3 {
  const gradient = new THREE.Vector3();
  const temp = new THREE.Vector3();
  const axes = [
    new THREE.Vector3(epsilon, 0, 0),
    new THREE.Vector3(0, epsilon, 0),
    new THREE.Vector3(0, 0, epsilon),
  ];

  for (let i = 0; i < 3; i++) {
    const axis = axes[i];
    const hit1 = {
      point: new THREE.Vector3(),
      distance: Infinity,
      faceIndex: -1,
    };
    const hit2 = {
      point: new THREE.Vector3(),
      distance: Infinity,
      faceIndex: -1,
    };

    temp.copy(point).add(axis);
    bvh.closestPointToPoint(temp, hit1);
    temp.copy(point).sub(axis);
    bvh.closestPointToPoint(temp, hit2);

    gradient.setComponent(i, (hit1.distance - hit2.distance) / (2 * epsilon));
  }

  return gradient;
}

// 改善された符号付き距離の計算
function getSignedDistance(
  point: THREE.Vector3,
  geometry: THREE.BufferGeometry,
  bvh: MeshBVH,
  raycaster: THREE.Raycaster,
  tempMesh: THREE.Mesh,
  directions: THREE.Vector3[]
): number {
  // 最近点の計算
  const hit = {
    point: new THREE.Vector3(),
    distance: Infinity,
    faceIndex: -1,
  };

  bvh.closestPointToPoint(point, hit);
  const distance = hit.distance;

  // 境界付近での特別な処理
  if (distance < CONFIG.BOUNDARY_EPSILON) {
    const gradient = computeGradient(
      point,
      CONFIG.BOUNDARY_EPSILON,
      geometry,
      bvh
    );
    const normal = gradient.normalize();
    const pointToSurface = new THREE.Vector3()
      .subVectors(point, hit.point)
      .normalize();
    return distance * (pointToSurface.dot(normal) < 0 ? -1 : 1);
  }

  // 改善された内外判定
  let inCount = 0;
  let validRays = 0;
  let weightedDistance = 0;
  let averageFirstHitDistance = 0;

  for (const dir of directions) {
    raycaster.set(point, dir);
    const intersects = raycaster.intersectObject(tempMesh, true);

    if (intersects.length > 0) {
      validRays++;
      weightedDistance += intersects[0].distance;
      inCount += intersects.length % 2; // 奇数回の交差でカウント増加
    }
  }

  // weightedDistanceを使用して判定を改善
  if (validRays > 0) {
    averageFirstHitDistance = weightedDistance / validRays;
    // 平均衝突距離と最近点距離を比較して判定を補強
    const isInside =
      inCount / validRays > 0.5 && distance < averageFirstHitDistance * 1.1; // 10%のマージンを追加
    return distance * (isInside ? -1 : 1);
  }

  // レイが有効でない場合は、単純な距離のみを返す
  return distance;
}

async function createSDF(
  geometry: THREE.BufferGeometry,
  size: number
): Promise<Float32Array> {
  const sdfData = new Float32Array(size * size * size);
  const tempData = new Float32Array(size * size * size);

  // バウンディングボックスの計算
  geometry.computeBoundingBox();
  const boundingBox = geometry.boundingBox!;
  const min = boundingBox.min.clone();
  const max = boundingBox.max.clone();
  const delta = new THREE.Vector3().subVectors(max, min).divideScalar(size);

  // BVHの構築
  const bvh = new MeshBVH(geometry);
  const tempMesh = new THREE.Mesh(geometry);
  const raycaster = new THREE.Raycaster();
  raycaster.firstHitOnly = true;

  // 均一に分布したレイの方向を生成
  const directions = generateUniformRayDirections(CONFIG.RAY_DIRECTIONS);

  // 初期SDF値の計算
  for (let z = 0; z < size; z++) {
    for (let y = 0; y < size; y++) {
      for (let x = 0; x < size; x++) {
        const idx = x + y * size + z * size * size;
        const point = new THREE.Vector3(
          min.x + (x + 0.5) * delta.x,
          min.y + (y + 0.5) * delta.y,
          min.z + (z + 0.5) * delta.z
        );

        sdfData[idx] = getSignedDistance(
          point,
          geometry,
          bvh,
          raycaster,
          tempMesh,
          directions
        );
      }
    }
    console.log(`初期SDF計算中... ${((z / size) * 100).toFixed(2)}%`);
  }

  // 距離場の平滑化
  const smoothingKernel = generateSmoothingKernel(CONFIG.SMOOTHING_RADIUS);
  console.log("距離場を平滑化中...");

  for (let z = 0; z < size; z++) {
    for (let y = 0; y < size; y++) {
      for (let x = 0; x < size; x++) {
        const idx = x + y * size + z * size * size;
        let sum = 0;
        let weightSum = 0;

        // 3Dカーネルの適用
        for (let dz = -1; dz <= 1; dz++) {
          for (let dy = -1; dy <= 1; dy++) {
            for (let dx = -1; dx <= 1; dx++) {
              const nx = x + dx;
              const ny = y + dy;
              const nz = z + dz;

              if (
                nx >= 0 &&
                nx < size &&
                ny >= 0 &&
                ny < size &&
                nz >= 0 &&
                nz < size
              ) {
                const nIdx = nx + ny * size + nz * size * size;
                const weight = smoothingKernel[dx + 1][dy + 1][dz + 1];
                sum += sdfData[nIdx] * weight;
                weightSum += weight;
              }
            }
          }
        }

        tempData[idx] = sum / weightSum;
      }
    }
  }

  // 結果の適用
  for (let i = 0; i < sdfData.length; i++) {
    sdfData[i] = tempData[i];
  }

  return sdfData;
}

// 3Dガウシアンカーネルの生成
function generateSmoothingKernel(radius: number): number[][][] {
  const size = 3;
  const kernel: number[][][] = Array(size)
    .fill(0)
    .map(() =>
      Array(size)
        .fill(0)
        .map(() => Array(size).fill(0))
    );

  for (let z = 0; z < size; z++) {
    for (let y = 0; y < size; y++) {
      for (let x = 0; x < size; x++) {
        const dx = x - 1;
        const dy = y - 1;
        const dz = z - 1;
        const distance = Math.sqrt(dx * dx + dy * dy + dz * dz);
        kernel[x][y][z] = Math.exp(
          -(distance * distance) / (2 * radius * radius)
        );
      }
    }
  }

  return kernel;
}

// メイン処理
(async () => {
  try {
    const glbPath = path.resolve(__dirname, "../public/model/sandglass.glb");
    const outputPath = path.resolve(
      __dirname,
      "../public/sdf/sandglass_sdf.json"
    );

    console.log(`GLBファイルを読み込み中: ${glbPath}`);

    const loader = new GLTFLoader();
    const arrayBuffer = fs.readFileSync(glbPath).buffer;

    const gltf: GLTF = await new Promise<GLTF>((resolve, reject) => {
      loader.parse(
        arrayBuffer,
        "",
        (gltf) => resolve(gltf),
        (error) => reject(error)
      );
    });

    const scene = gltf.scene;
    scene.updateMatrixWorld(true);

    let innerMesh: THREE.Mesh = undefined!;
    scene.traverse((child) => {
      if ((child as THREE.Mesh).isMesh && child.name === "inner") {
        innerMesh = child as THREE.Mesh;
      }
    });

    if (!innerMesh) {
      throw new Error('メッシュ "inner" が見つかりませんでした。');
    }

    let transformedGeometry = innerMesh.geometry.clone();
    transformedGeometry.applyMatrix4(innerMesh.matrixWorld);

    if (!transformedGeometry.index) {
      transformedGeometry =
        BufferGeometryUtils.mergeVertices(transformedGeometry);
    }

    transformedGeometry.computeVertexNormals();

    const sdfData = await createSDF(transformedGeometry, CONFIG.SDF_SIZE);
    const box = transformedGeometry.boundingBox!;

    const sdfJson = {
      size: CONFIG.SDF_SIZE,
      min: [box.min.x, box.min.y, box.min.z],
      max: [box.max.x, box.max.y, box.max.z],
      data: Array.from(sdfData),
    };

    const outputDir = path.dirname(outputPath);
    if (!fs.existsSync(outputDir)) {
      fs.mkdirSync(outputDir, { recursive: true });
    }

    fs.writeFileSync(outputPath, JSON.stringify(sdfJson));
    console.log("SDFデータを保存しました:", outputPath);
  } catch (error) {
    console.error("エラーが発生しました:", error);
    process.exit(1);
  }
})();
