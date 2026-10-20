use std::sync::Arc;

fn main() {
	let host = Arc::new(rpi_js::ProcessHost::new());
	let mut runtime = rpi_js::Runtime::new(host).expect("the runtime starts");
	println!("result: {:?}", runtime.eval("1+1").expect("the script runs"));
	println!("cwd: {:?}", runtime.eval("process.cwd()").expect("the cwd is there"));
	std::thread::sleep(std::time::Duration::from_secs(20));
}
