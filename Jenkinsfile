pipeline {
    agent any

    options {
        skipDefaultCheckout()
        disableConcurrentBuilds()
        timeout(time: 20, unit: 'MINUTES')
    }

    stages {
        stage('Checkout') {
            steps {
                checkout scm
                script {
                    def commit = sh(script: 'git rev-parse --short=12 HEAD', returnStdout: true).trim()
                    env.IMAGE_REF = "quansheng-demo:" + commit + "-" + env.BUILD_NUMBER
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
                sh 'docker run --rm "$IMAGE_REF" npm test'
            }
        }

        stage('Smoke test') {
            steps {
                sh '''
                    set -eu
                    container_id=$(docker run -d "$IMAGE_REF")
                    trap 'docker rm -f "$container_id" >/dev/null 2>&1 || true' 0
                    if ! docker exec "$container_id" node scripts/smoke.cjs; then
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
                    echo "QUANSHENG_IMAGE=$IMAGE_REF" > build-artifacts/deploy.env
                    cp compose.deploy.yaml build-artifacts/
                '''
                archiveArtifacts artifacts: 'build-artifacts/quansheng-image.tar.gz,build-artifacts/deploy.env,build-artifacts/compose.deploy.yaml', fingerprint: true
            }
        }
    }
}
