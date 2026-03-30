import * as Updates from 'expo-updates';

export async function checkForUpdates() {
  if (__DEV__) {
    return '开发模式已跳过 OTA 检查';
  }

  try {
    const update = await Updates.checkForUpdateAsync();
    if (update.isAvailable) {
      await Updates.fetchUpdateAsync();
      return '已获取最新更新，重启应用后生效';
    }
    return '当前已是最新版本';
  } catch {
    return '更新服务不可用，请稍后重试';
  }
}
