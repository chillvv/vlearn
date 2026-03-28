install:
	npm install
	npm --prefix packages/mobile install --legacy-peer-deps
	npm --prefix tests/visual install

generate-design:
	node scripts/generate-ui-kit.mjs

mobile-dev:
	npm --prefix packages/mobile run start

mobile-web:
	npm --prefix packages/mobile run web

mobile-typecheck:
	npm --prefix packages/mobile run typecheck

visual-test:
	npm --prefix tests/visual run test

build-qr:
	cd packages/mobile && npx eas build --profile preview --platform all

testflight:
	cd packages/mobile && npx eas submit --platform ios --profile production

pgyer:
	powershell -ExecutionPolicy Bypass -Command "Invoke-RestMethod -Method Post -Uri https://www.pgyer.com/apiv2/app/upload -Form @{ _api_key = $$env:PGYER_API_KEY; buildInstallType = '2'; file = Get-Item './packages/mobile/dist/app-release.apk' }"

ota-preview:
	cd packages/mobile && npx eas update --channel preview --message "preview update"
