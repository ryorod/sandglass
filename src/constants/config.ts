export const ENVIRONMENT_MAPS = {
  1: "/tex/kloppenheim_06_puresky_4k.exr",
  2: "/tex/overcast_soil_puresky_4k.exr",
  3: "/tex/table_mountain_1_puresky_4k.exr",
  4: "/tex/belfast_sunset_puresky_4k.exr",
} as const;

export const GLB_PATH = "/model/sandglass.glb";
export const SDF_PATH = "/sdf/sandglass_sdf.json";

export const NUM_PARTICLES = 1024 * 1024;

export const INTERACTION_TIMEOUT = 10; // マウス操作後、自動回転を再開するまでの待機時間（ミリ秒）
export const AUTO_ROTATION_SPEED = 0.0005; // 自動回転の速度
export const CAMERA_ORBIT_RADIUS = 2; // カメラの軌道半径
