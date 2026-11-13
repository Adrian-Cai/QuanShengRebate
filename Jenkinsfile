pipeline {
    agent any

    options {
        skipDefaultCheckout()
        disableConcurrentBuilds()
        timeout(time: 20, unit: 'MINUTES')
    }

    // CI 全程离线：不注入 TAOBAO_* 或 QUANSHENG_PRODUCT_REF_KEY，不调用淘宝网关。
    // 真实调用验收（G0）必须在账号权限核对完成后，于受控环境人工执行：
    //   npm start（QUANSHENG_UPSTREAM=live + 凭据）→ npm run smoke -- --live
    // 若将来要在 Jenkins 加受控人工 stage，应使用 input + credentials binding，
    // 且该 stage 不得进入默认流水线，避免凭据出现在构建日志中。

    stages {
        stage('Checkout') {
            steps {
                checkout scm
                script {
                    def commit = sh(script: 'git rev-parse --short=12 HEAD', returnStdout: true).trim()
                    env.IMAGE_REF = "quansheng:" + commit + "-" + env.BUILD_NUMBER
                }
            }
        }

        stage('Build image') {
            steps {
                sh 'docker build --tag "$IMAGE_REF" .'
            }
        }

        stage('Test') {
            steps {
                // 离线契约测试：字段映射、金额精度、券/到手价口径、游标、错误码、缓存。
                sh 'docker run --rm "$IMAGE_REF" npm test'
            }
        }

        stage('Smoke test') {
            steps {
                sh '''
                    set -eu
                    # fixture 仅用于离线回归，不注入任何密钥；响应全程标注为合成数据。
                    container_id=$(docker run -d -e QUANSHENG_UPSTREAM=fixture "$IMAGE_REF")
                    trap 'docker rm -f "$container_id" >/dev/null 2>&1 || true' 0
                    if ! docker exec "$container_id" node scripts/smoke.cjs http://127.0.0.1:3000; then
                        docker logs "$container_id"
                        exit 1
                    fi
                '''
            }
        }

        stage('Archive') {
            steps {
                sh '''
                    set -eu
                    mkdir -p build-artifacts
                    docker image save -o build-artifacts/quansheng-image.tar "$IMAGE_REF"
                    gzip -f build-artifacts/quansheng-image.tar
                    # deploy.env 只记录镜像标签，不含任何密钥。
                    echo "QUANSHENG_IMAGE=$IMAGE_REF" > build-artifacts/deploy.env
                    cp compose.deploy.yaml build-artifacts/
                '''
                archiveArtifacts artifacts: 'build-artifacts/quansheng-image.tar.gz,build-artifacts/deploy.env,build-artifacts/compose.deploy.yaml', fingerprint: true
            }
        }
    }
}
