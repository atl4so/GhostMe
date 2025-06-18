# Getting started

Make sure you have the latest version of git downloaded - https://git-scm.com/downloads

Confirm your download by viewing the version number in your command line interface with:
```
git version
```
Clone this repo with:
```
git clone https://github.com/K-Kluster/Kasia.git
```

## Build the cipher wasm package

Install Rust locally, and install `wasm-pack` using `cargo install wasm-pack`.

Follow these commands after installing wasm-pack

```
cd Kasia
```
```
cd ./cipher
```
```
wasm-pack build --target web --release -d ../cipher-wasm
```

Install NodeJs - https://nodejs.org/en/download

- Download the latest `kaspa-wasm32-sdk-v1.0.0.zip` or build yourself [WASM precompiled binaries] found here - https://github.com/kaspanet/rusty-kaspa/releases
- Extract all the contents within this file `kaspa-wasm32-sdk\web\kaspa` into `\Kasia\wasm`

Enter into the Kasia directory with:
```
cd Kasia . .
```
Then to run locally enter these two commands:

```
npm i
```
```
npm run dev
```
