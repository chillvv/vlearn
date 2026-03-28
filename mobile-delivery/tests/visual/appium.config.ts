export const appiumConfig = {
  server: {
    hostname: '127.0.0.1',
    port: 4723,
    path: '/wd/hub',
  },
  capabilities: [
    {
      platformName: 'Android',
      'appium:automationName': 'UiAutomator2',
      'appium:deviceName': 'Pixel 8',
      'appium:appPackage': 'com.aiweb.mobile',
      'appium:appActivity': '.MainActivity',
      'appium:noReset': true,
    },
    {
      platformName: 'iOS',
      'appium:automationName': 'XCUITest',
      'appium:deviceName': 'iPhone 15',
      'appium:bundleId': 'com.aiweb.mobile',
      'appium:noReset': true,
    },
  ],
  threshold: 0.002,
};
