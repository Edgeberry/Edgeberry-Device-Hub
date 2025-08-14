import { Button, Modal } from "react-bootstrap";
import { FontAwesomeIcon } from "@fortawesome/react-fontawesome";
import { faScaleUnbalanced } from "@fortawesome/free-solid-svg-icons";

const TermsAndConditionsModal = ( props:{ show:boolean, onClose:Function })=>{
    return(<>
            <Modal size={'lg'} onHide={()=>{props.onClose()}} show={props.show} >
                <Modal.Header closeButton>
                    <Modal.Title><FontAwesomeIcon icon={faScaleUnbalanced}/> Terms and Conditions & Privacy Policy</Modal.Title>
                </Modal.Header>
                <Modal.Body>
                    <h4>Acceptance of Terms</h4>
                    <p>
                        By explicitly accepting these terms on account creation, and accessing and using the Edgeberry Fleet Hub (the "Service"), 
                        provided by Edgeberry, you (the "User") agree to be bound by these Terms of Service ("Terms"). These Terms govern your 
                        use of the Service, and by using the Service, you acknowledge that you have read, understood, and agree to be bound by 
                        these Terms, including any future modifications. If you do not agree to these Terms, you are not authorized to use the 
                        Service. Your use of the Service is also subject to our Privacy Policy. We may update these Terms at any time. Continued 
                        use of the Service means you accept any changes. Review these Terms regularly.
                    </p>
                    <h4>Privacy Policy</h4>
                    <p>
                        Edgeberry values your privacy. We collect your name for identification within the platform, your e-mail address 
                        for account registration, communication and password recovery, and a password to secure your account. We use this 
                        information to create and manage your account, communicate with you and ensure account security. To manage your user 
                        session while using the Service, we use a cookie with an access token on your device. This token helps us authenticate 
                        your session and maintain secure access to the Service.

                        Your password is stored encrypted, and we use security measures to protect your data. We do not share your 
                        information with third parties, except as required by law.
                    </p>
                    <h4>User responsiblities</h4>
                    <p>
                        By using the Service, you agree to use the Service only for lawful purposes and in accordance with these Terms. 
                        You are responsible for your actions while using the Service and for any content you create or transmit. You agree 
                        not to use the Service to:
                    </p>
                    <ul>
                        <li>
                            Upload, post or transmit any content that is unlawful, harmful, threatening, abusive, harassing, defamatory,
                            vulgar, hateful or otherwise morally objectionable.
                        </li>
                        <li>
                            Engage in any activity that could harm or disrupt the Service or the networks or services connected to 
                            this Service.
                        </li>
                        <li>
                            Attempt to gain unauthorized access to any part of the Service, other user accounts or any systems or networks 
                            connected to the Service.
                        </li>
                        <li>
                            Use the Service for any fraudulent or malicious activities.
                        </li>
                    </ul>
                    <p>
                        Failure to comply with these responsibilities may result in suspension or termination of you access to the Service.
                    </p>
                    <h4>User Account</h4>
                    <p>
                        To access this Service, you need to create an account. Upon registration, you will need to confirm and activate your 
                        account by following the instructions in the confirmation e-mail. You can access and update your account information 
                        through the account settings. We retain your personal data as long as your account is active for using the Service. 
                        You have full control over your data, and you can delete your account at any time through the account settings. When 
                        you delete your account, all associated data will be permanently removed from our systems, unless retention is required 
                        by law. In compliance with GDPR, you have the right to access, correct, delete and transfer your personal data. You can 
                        exercise these rights by using the provided tools on the Service, or by contacting us. You are responsible for protecting 
                        your personal account by safely handling your password.

                        We reserve the right to suspend or terminate your account if you violate these Terms or engage in unlawful or harmful 
                        activities.
                    </p>
                    <h4>The Service</h4>
                    <p>
                        This Service, Edgeberry Fleet Hub, is designed as a device management tool for IoT devices running the Edgeberry device 
                        software. The Service is provided "as is" without any warranties. We strive to keep the service running smoothly and 
                        securely, but do not guarantee it will be free of errors or interruptions. We are not liable for any damages arising from 
                        the use of this software. Use it at your own risk. The Edgeberry Fleet Hub is licensed under GPLv3. By using it, you 
                        agree to comply with the GPLv3 terms. We will make our best effort to maintain the service but cannot guarantee continuous 
                        availability.
                        <br/><br/>
                        <strong>
                            While the Edgeberry Fleet Hub is licensed under GPLv3, this license does NOT apply to your own inventions making use 
                            of the this Service. You retain full ownership and control over your work.
                        </strong>
                    </p>
                    <h4></h4>
                    <p></p>
                    <h4>Conclusion</h4>
                    <p>
                        We strive to ensure your experience with Edgeberry Fleet Hub is seamless, useful and enjoyable. While this document outlines 
                        the legalities, our main goal is to create a collaborative, innnovative and secure environment for you to explore your ideas. 
                        By adhering to these guidelines, we can focus on what truly matters: building and sharing great technology together. Let's 
                        enjoy the journey with mutual respect and creativity. Welcome to Edgeberry!
                    </p>
                </Modal.Body>
                <Modal.Footer>
                    <Button variant={'danger'} onClick={()=>{props.onClose()}}>Close</Button>
                </Modal.Footer>
            </Modal>
        </>);
}

export default TermsAndConditionsModal;