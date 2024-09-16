import Link from "next/link";

const Header = () => {
  return (
    <>
    <br></br><br></br>
    <div className="flex items-center justify-between">
    <nav className="ml-auto md:text-3xl font-bold space-x-6"  style={{ marginLeft: '0px' }}>
        <Link href="/">Home</Link>
        <Link href="/about">About Me</Link>
     </nav>
     </div>
     <hr className="border-neutral-200 mt-12 mb-24" />
    </>
    
  );
};

export default Header;