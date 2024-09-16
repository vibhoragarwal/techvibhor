import Link from "next/link";

const Header = () => {
  return (
    <>
    <br></br><br></br>
    <div className="flex items-center justify-between">
    <nav className="ml-auto md:text-3xl font-bold space-x-6">
        <Link href="/">Home</Link><span></span>
        <Link href="/about">About me</Link>
     </nav>
     </div>
     <hr className="border-neutral-200 mt-12 mb-24" />
    </>
    
  );
};

export default Header;